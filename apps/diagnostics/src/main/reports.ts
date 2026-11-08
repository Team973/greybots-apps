// Reports (#148): a template run over a log. What it shows is read once,
// when it's made, and kept with it in the data folder's reports/, so a
// report reads the same later, whatever becomes of the log or template.
// Pipelines make them for new logs as they're offloaded or imported.

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

import { checkDevices, deviceProblems, loggingSignal, type DeviceFound, type DeviceHealth, type DeviceSpec, type HootFound } from '@shared/devices';
import { brownoutCount, phaseLabels, type LogEvent, type MatchPhase, type SessionEvents } from '@shared/events';
import type { SignalLogFile } from '@shared/ipc';
import {
  isProblem,
  reportProblems,
  sectionLists,
  reportSummary,
  templateKeys,
  theAutoReport,
  visionMonitor,
  type Pipeline,
  type RenderedSection,
  type Report,
  type ReportLine,
  type ReportPieSlice,
  type ReportScope,
  type ReportStatsRow,
  type ReportSummary,
  type ReportTemplate,
  type ViewSpan
} from '@shared/library';
import { describeMatch } from '@shared/offload';
import type { Series } from '@shared/monitors';
import { duplicateReports } from '@shared/report-cards';
import { visionSummary } from '@shared/vision';
import { isReport, reportFileNames, type ReportExport, type ReportImport } from '@shared/report-files';
import { cancelledMessage, type PipelineRun, type PipelineStatus } from '@shared/reports';
import type { Settings } from '@shared/settings';
import { matchKey, type KeyMatch } from '@shared/signal-match';
import { integrateProduct, pairedVoltage, type SignalInfo, type SignalSeries } from '@shared/signals';
import { reportPathSegments } from '@shared/storage-layout';
import { compareSymmetry, spansWhereText, type SymmetryRow } from '@shared/symmetry';
import { getLibraryItem, listLibrary } from './library-store';
import { loadNotes } from './notes-store';
import { loadSettings } from './settings-store';
import { forgetFiles, hootStatus, openSignalLog, prepareSignals, readSignal, sessionEvents, signalLogs } from './signals-service';
import { dataDirectory } from './storage';

const reportPath = (settings: Settings, id: string) => join(dataDirectory(settings), ...reportPathSegments(id));

// Points kept per line: about what a chart a page wide draws.
const pointsPerLine = 1200;
// How long to wait for Hoot logs to line up and their faults to be found.
const waitForHootMs = 120_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function logLabel(file: SignalLogFile): string {
  const when = new Date(file.recorded).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  return file.match ? `${describeMatch(file.match)}, ${when}` : `${when} (${file.name})`;
}

// --- Spans ---

const phaseSpans = (phases: MatchPhase[], name: MatchPhase['name']): [number, number][] =>
  phases.filter((p) => p.name === name).map((p) => [p.start, p.end]);

// The whole match: from the first phase's start to the last's end, or the
// whole log when there are none.
function matchSpan(phases: MatchPhase[], whole: [number, number]): [number, number] {
  if (phases.length === 0) return whole;
  return [Math.min(...phases.map((p) => p.start)), Math.max(...phases.map((p) => p.end))];
}

// Where a boolean series is `value`, as spans within `whole`.
function spansWhere(series: SignalSeries, value: boolean, whole: [number, number]): [number, number][] {
  const out: [number, number][] = [];
  let from: number | null = null;
  const values = series.values as Float64Array;
  for (let i = 0; i < values.length; i++) {
    const holds = (values[i] === 1) === value;
    if (holds && from === null) from = series.times[i];
    if (!holds && from !== null) {
      out.push([from, series.times[i]]);
      from = null;
    }
  }
  if (from !== null) out.push([from, whole[1]]);
  return out;
}

function intersect(a: [number, number][], b: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [s1, e1] of a) for (const [s2, e2] of b) {
    const start = Math.max(s1, s2);
    const end = Math.min(e1, e2);
    if (end > start) out.push([start, end]);
  }
  return out.sort((x, y) => x[0] - y[0]);
}

// --- Making a report ---

interface Context {
  settings: Settings;
  logId: string;
  signals: Map<string, SignalInfo>;
  available: string[];
  matches: Map<string, KeyMatch>;
  missing: Set<string>;
  whole: [number, number];
  review: SessionEvents;
}

function resolve(context: Context, wanted: string): string | null {
  let match = context.matches.get(wanted);
  if (!match) {
    match = matchKey(wanted, context.available);
    context.matches.set(wanted, match);
  }
  if (!match.key) context.missing.add(wanted);
  return match.key;
}

const labelOf = (info: SignalInfo | undefined, key: string) => (info ? (info.subsystem ? `${info.subsystem} / ${info.name}` : info.name) : key);

async function scopeSpans(context: Context, scope: ReportScope): Promise<[number, number][]> {
  const { phases } = context.review;
  switch (scope.type) {
    case 'match':
      return [matchSpan(phases, context.whole)];
    case 'enabled': {
      const spans = (context.review.enabled ?? []).map(([start, end]): [number, number] =>
        [Math.max(start, context.whole[0]), Math.min(end, context.whole[1])]).filter(([start, end]) => end > start);
      if (spans.length === 0) throw new Error('The robot was never enabled in this log.');
      return spans;
    }
    case 'auto':
    case 'teleop': {
      const spans = phaseSpans(phases, scope.type);
      if (spans.length === 0) throw new Error(`This log has no ${scope.type === 'auto' ? 'autonomous' : 'teleop'} period.`);
      return spans;
    }
    case 'conditions': {
      if (scope.conditions.length === 0) return [context.whole];
      let spans: [number, number][] = [context.whole];
      for (const condition of scope.conditions) {
        const key = resolve(context, condition.key);
        const series = key ? await readSignal(context.settings, context.logId, key, {}) : null;
        if (!series) throw new Error(`This log hasn't ${condition.key}, which the report's conditions need.`);
        spans = intersect(spans, spansWhere(series, condition.value, context.whole));
      }
      if (spans.length === 0) throw new Error('The conditions the report needs never all held in this log.');
      return spans;
    }
  }
}

// A chart's span: the report's, or the phase the view asks for if the log has it.
function chartSpan(context: Context, span: ViewSpan, spans: [number, number][]): [number, number] {
  const reportSpan: [number, number] = [Math.min(...spans.map((s) => s[0])), Math.max(...spans.map((s) => s[1]))];
  if (span.type !== 'phase') return reportSpan;
  if (span.phase === 'match') return matchSpan(context.review.phases, context.whole);
  const phase = phaseSpans(context.review.phases, span.phase);
  return phase.length ? [phase[0][0], phase[phase.length - 1][1]] : reportSpan;
}

async function statsOver(context: Context, key: string, spans: [number, number][]): Promise<{ min: number; max: number; mean: number } | null> {
  let min = Infinity;
  let max = -Infinity;
  let weighted = 0;
  let total = 0;
  for (const [start, end] of spans) {
    const series = await readSignal(context.settings, context.logId, key, { start, end, maxPoints: 2 }).catch(() => null);
    if (!series?.stats) continue;
    min = Math.min(min, series.stats.min);
    max = Math.max(max, series.stats.max);
    weighted += series.stats.mean * (end - start);
    total += end - start;
  }
  return Number.isFinite(min) ? { min, max, mean: total > 0 ? weighted / total : (min + max) / 2 } : null;
}

// Energy over the spans, in watt-hours, of a current times a voltage: each
// held until its next value, as the line chart draws them. Null when either
// has no values there.
async function energyOver(context: Context, currentKey: string, voltageKey: string, spans: [number, number][]): Promise<number | null> {
  let joules = 0;
  let any = false;
  for (const [start, end] of spans) {
    const current = await readSignal(context.settings, context.logId, currentKey, { start, end }).catch(() => null);
    const voltage = await readSignal(context.settings, context.logId, voltageKey, { start, end }).catch(() => null);
    if (!current?.times.length || !voltage?.times.length) continue;
    any = true;
    joules += integrateProduct(current.times, current.values as Float64Array, voltage.times, voltage.values as Float64Array, start, end);
  }
  return any ? joules / 3600 : null;
}

const formatSeconds = (s: number) => (s >= 120 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${s.toFixed(1)} s`);

// Battery, from whichever signal the log calls it.
const batteryPattern = /(^|\/)(battery ?voltage|batteryvoltage|vbat|batteryvolts)$/i;

// Errors, warnings and brownouts: the report's own problems (see
// reportProblems). Brownouts only where it lists the log's events.
async function summaryFacts(context: Context, file: SignalLogFile, spans: [number, number][], problems: LogEvent[], listsEvents: boolean) {
  const facts: { label: string; value: string }[] = [];
  const span = spans.reduce((t, [s, e]) => t + (e - s), 0);
  facts.push({ label: 'Log', value: logLabel(file) });
  facts.push({ label: 'Robot', value: file.robot || '—' });
  facts.push({ label: 'Span', value: spans.length > 1 ? `${formatSeconds(span)} in ${spans.length} stretches` : `${spans[0][0].toFixed(1)}–${spans[0][1].toFixed(1)} s (${formatSeconds(span)})` });
  for (const phase of context.review.phases) {
    facts.push({ label: phaseLabels[phase.name], value: `${phase.start.toFixed(1)}–${phase.end.toFixed(1)} s` });
  }
  facts.push({ label: 'Errors', value: String(problems.filter((e) => e.severity === 'error').length) });
  facts.push({ label: 'Warnings', value: String(problems.filter((e) => e.severity === 'warning').length) });
  if (listsEvents) {
    // Brownouts, not each time the roboRIO's flag came on (see brownoutCount).
    const { brownouts, flags } = brownoutCount(problems);
    facts.push({ label: 'Brownouts', value: flags > brownouts ? `${brownouts} (the roboRIO's brownout flag on ${flags} times)` : String(brownouts) });
  }
  const battery = context.available.find((key) => batteryPattern.test(key));
  if (battery) {
    const stats = await statsOver(context, battery, spans);
    if (stats) facts.push({ label: 'Battery', value: `${stats.min.toFixed(2)} V lowest, ${stats.mean.toFixed(2)} V on average` });
  }
  return facts;
}

const isRoutine = (event: LogEvent) => event.severity === 'info' && !['mode', 'note', 'state', 'command'].includes(event.kind);

// Cancelling: every report being run, or waiting to be, stops. Each report
// notes this count when it starts and stops at its next step if it has
// changed since; nothing of it is saved.
let cancels = 0;
export function cancelReports() {
  cancels += 1;
}
function cancelCheck(): () => void {
  const at = cancels;
  return () => {
    if (cancels !== at) throw new Error(cancelledMessage);
  };
}
const isCancelled = (error: unknown) => (error as Error)?.message === cancelledMessage;

async function waitForSession(settings: Settings, logId: string, stopIfCancelled: () => void): Promise<SessionEvents> {
  const until = Date.now() + waitForHootMs;
  // Hoot logs lined up first: until then the timeline and catalog aren't whole.
  while (Date.now() < until) {
    stopIfCancelled();
    const status = await hootStatus(settings, logId);
    if (!status.hoots.some((h) => h.state === 'opening') && status.progress === null) break;
    await sleep(500);
  }
  let review = await sessionEvents(settings, logId);
  while (review.pending && Date.now() < until) {
    stopIfCancelled();
    await sleep(1000);
    review = await sessionEvents(settings, logId);
  }
  return review;
}

export async function makeReport(settings: Settings, template: ReportTemplate, logId: string, by: string): Promise<Report> {
  const stopIfCancelled = cancelCheck();
  const file = (await signalLogs(settings)).find((log) => log.id === logId);
  if (!file) throw new Error('That log is not in the data folder.');
  const review = await waitForSession(settings, logId, stopIfCancelled);
  stopIfCancelled();
  const summary = await openSignalLog(settings, logId);
  const status = await hootStatus(settings, logId);
  const signals = new Map(summary.signals.map((s) => [s.key, s]));
  const context: Context = {
    settings,
    logId,
    signals,
    available: summary.signals.filter((s) => s.kind !== 'other' && s.count !== 0).map((s) => s.key),
    matches: new Map(),
    missing: new Set(),
    whole: [status.start, status.end],
    review
  };
  // The cache of matches starts with every signal the template asks for.
  const wanted = new Set<string>();
  for (const key of templateKeys(template.sections, template.scope)) {
    const found = resolve(context, key);
    if (found) wanted.add(found);
  }
  // With each energy pie's currents, their own voltages.
  for (const section of template.sections) {
    if (section.type !== 'pie' || section.measure !== 'energy' || section.voltage) continue;
    for (const key of section.slices.flatMap((s) => s.keys)) {
      const current = context.matches.get(key)?.key;
      const voltage = current ? resolve(context, pairedVoltage(current)) : null;
      if (voltage) wanted.add(voltage);
    }
  }
  // Device Health: which Hoot log each device listed is in, and its logging
  // signal, exported with the rest. Not looked up as a signal asked for: a
  // device missing is an error of its own, not a signal missing.
  const allKeys = summary.signals.map((s) => s.key);
  const deviceSpecs = template.sections.flatMap((s) => (s.type === 'devices' ? s.devices : []));
  const deviceHoot = new Map<string, string | null>();
  for (const spec of deviceSpecs) {
    if (deviceHoot.has(spec.device)) continue;
    const hoot = status.hoots.find((h) => allKeys.some((k) => k.startsWith(`${h.label}/${spec.device}/`)))?.label ?? null;
    deviceHoot.set(spec.device, hoot);
    const key = hoot ? `${hoot}/${loggingSignal(spec.device)}` : '';
    if (key && allKeys.includes(key)) wanted.add(key);
  }
  // Hoot signals exported all at once, rather than one by one as read.
  stopIfCancelled();
  await prepareSignals(settings, logId, [...wanted]);
  stopIfCancelled();

  const spans = await scopeSpans(context, template.scope);
  const inSpans = (e: { start: number; end: number | null }) => spans.some(([s, end]) => e.start <= end && (e.end ?? e.start) >= s);
  const notes = (await loadNotes(settings, logId)).map((note): LogEvent => ({
    id: `note:${note.id}`,
    kind: 'note',
    severity: 'info',
    start: note.time,
    end: null,
    title: note.text.split('\n')[0],
    detail: note.text.split('\n').slice(1).join('\n').trim(),
    count: 1,
    key: null
  }));
  const events = [...review.events, ...notes].filter(inSpans).sort((a, b) => a.start - b.start);
  const monitors = (review.monitors ?? []).map((result) => ({ ...result, alarms: result.alarms.filter(inSpans) }));
  // Each device's logging and faults, for every Device Health section.
  const deviceFound = new Map<string, DeviceFound>();
  for (const spec of deviceSpecs) {
    if (deviceFound.has(spec.device)) continue;
    const hoot = deviceHoot.get(spec.device) ?? null;
    const key = hoot ? `${hoot}/${loggingSignal(spec.device)}` : '';
    const series = key && allKeys.includes(key)
      ? await readSignal(settings, logId, key, { start: spans[0][0], end: spans[spans.length - 1][1] }).catch(() => null)
      : null;
    const faults = hoot ? events.filter((e) => e.kind === 'fault' && (e.key ?? '').startsWith(`${hoot}/${spec.device}/`)) : [];
    deviceFound.set(spec.device, { hoot, times: series ? series.times : null, faults });
  }
  const found = (device: string): DeviceFound => deviceFound.get(device) ?? { hoot: null, times: null, faults: [] };
  const hootsFound: HootFound[] = status.hoots.map((h) => ({ bus: h.bus, label: h.label, name: h.localPath.split('/').pop() ?? h.localPath, state: h.state, message: h.message }));
  const deviceHealth = (specs: DeviceSpec[]): DeviceHealth =>
    checkDevices(specs, file.localPath ? file.localPath.split('/').pop() ?? file.localPath : null, hootsFound, found, spans);
  const devicesProblems = template.sections.flatMap((s) => (s.type === 'devices' ? deviceProblems(deviceHealth(s.devices), spans, found) : []));
  const problems = [...reportProblems(template.sections, events, monitors), ...devicesProblems]
    .filter((p, i, all) => all.findIndex((q) => q.id === p.id) === i)
    .sort((a, b) => a.start - b.start);
  const listsEvents = template.sections.some((s) => s.type === 'events');

  const sections: RenderedSection[] = [];
  for (const section of template.sections) {
    stopIfCancelled();
    switch (section.type) {
      case 'heading':
      case 'text':
        sections.push(section);
        break;
      case 'summary':
        sections.push({ type: 'summary', facts: await summaryFacts(context, file, spans, problems, listsEvents) });
        break;
      case 'chart': {
        const view = chartSpan(context, section.view.span, spans);
        const lines: ReportLine[] = [];
        const missing: string[] = [];
        for (const trace of section.view.traces) {
          if (trace.hidden) continue;
          const key = resolve(context, trace.key);
          const series = key ? await readSignal(settings, logId, key, { start: view[0], end: view[1], maxPoints: pointsPerLine }).catch(() => null) : null;
          if (!key || !series) {
            missing.push(trace.key);
            continue;
          }
          const info = signals.get(key);
          lines.push({
            key,
            label: labelOf(info, key),
            unit: info?.unit || series.unit || '',
            color: trace.color,
            axis: series.kind === 'string' ? 'lanes' : trace.axis === 'lanes' && series.kind !== 'boolean' ? section.view.axes[0]?.id ?? 'axis1' : trace.axis,
            band: trace.band,
            kind: series.kind,
            times: Array.from(series.times),
            values: series.kind === 'string' ? [...(series.values as string[])] : Array.from(series.values as Float64Array)
          });
        }
        sections.push({ type: 'chart', title: section.title, axes: section.view.axes, lines, view, missing });
        break;
      }
      case 'stats': {
        const rows: ReportStatsRow[] = [];
        const missing: string[] = [];
        for (const wanted of section.keys) {
          const key = resolve(context, wanted);
          if (!key) {
            missing.push(wanted);
            continue;
          }
          const info = signals.get(key);
          const stats = info?.kind === 'string' ? null : await statsOver(context, key, spans);
          rows.push({ key, label: labelOf(info, key), unit: info?.unit ?? '', min: stats?.min ?? null, max: stats?.max ?? null, mean: stats?.mean ?? null });
        }
        sections.push({ type: 'stats', title: section.title, rows, missing });
        break;
      }
      case 'pie': {
        const seconds = spans.reduce((t, [s, e]) => t + (e - s), 0);
        const energy = section.measure === 'energy';
        const shared = energy && section.voltage ? resolve(context, section.voltage) : null;
        const slices: ReportPieSlice[] = [];
        let unit = energy ? 'W' : '';
        for (const spec of section.slices) {
          const slice: ReportPieSlice = { label: spec.label, keys: [], missing: [], mean: 0, total: 0 };
          for (const wanted of spec.keys) {
            const key = resolve(context, wanted);
            if (!key) {
              slice.missing.push(wanted);
            } else if (energy) {
              // Watt-hours; the mean is power, in watts.
              const voltage = section.voltage ? shared : resolve(context, pairedVoltage(key));
              const wh = voltage ? await energyOver(context, key, voltage, spans) : null;
              if (wh === null) {
                slice.missing.push(voltage ? wanted : section.voltage || pairedVoltage(key));
                continue;
              }
              slice.keys.push(key);
              slice.total += wh;
            } else {
              const stats = await statsOver(context, key, spans);
              if (!stats) {
                slice.missing.push(wanted);
                continue;
              }
              slice.keys.push(key);
              slice.mean += stats.mean;
              unit ||= signals.get(key)?.unit ?? '';
            }
          }
          // Unnamed, a slice is called after its signal.
          if (!slice.label.trim()) slice.label = slice.keys.length === 1 ? labelOf(signals.get(slice.keys[0]), slice.keys[0]) : spec.keys.join(', ');
          if (energy) slice.mean = seconds > 0 ? (slice.total * 3600) / seconds : 0;
          else slice.total = slice.mean * seconds;
          slices.push(slice);
        }
        sections.push({ type: 'pie', title: section.title, measure: section.measure, unit, seconds, slices });
        break;
      }
      case 'events': {
        const chosen = events.filter((e) => sectionLists(section, e) && (section.problemsOnly ? isProblem(e) : !isRoutine(e)));
        sections.push({ type: 'events', title: section.title, events: chosen });
        break;
      }
      case 'monitors': {
        const results = monitors.filter((result) => section.ids.length === 0 || section.ids.includes(result.id));
        sections.push({ type: 'monitors', title: section.title, results });
        break;
      }
      case 'vision': {
        // Every camera counter and measurement, and the fused pose, read
        // whole first: the summary looks them up as it goes.
        const keys = context.available.filter((key) => /\/providers\/ll[^/]+\/(perf\/|mt[12]\/)/i.test(key) || /\/estimators\/fused\/pose\//i.test(key));
        const read = new Map<string, Series>();
        for (const key of keys) {
          const series = await readSignal(settings, logId, key, {}).catch(() => null);
          if (series && series.values instanceof Float64Array) read.set(key, { times: series.times, values: series.values });
        }
        const lookup = (wanted: string) => {
          const key = matchKey(wanted, keys).key;
          const series = key ? read.get(key) : undefined;
          return key && series ? { key, series } : null;
        };
        const alarms = monitors.filter((r) => r.id === visionMonitor).flatMap((r) => r.alarms);
        sections.push({ type: 'vision', title: section.title, summary: visionSummary(lookup, keys, spans), alarms, recorded: file.recorded });
        break;
      }
      case 'devices':
        sections.push({ type: 'devices', title: section.title, health: deviceHealth(section.devices) });
        break;
      case 'symmetry': {
        const rows: SymmetryRow[] = [];
        for (const pair of section.pairs) {
          const a = resolve(context, pair.a);
          const b = resolve(context, pair.b);
          // Read whole, so the value held into each span is there.
          const read = async (key: string | null) => {
            const series = key ? await readSignal(settings, logId, key, {}).catch(() => null) : null;
            return series && series.values instanceof Float64Array ? { times: series.times, values: series.values } : null;
          };
          const [sa, sb] = [await read(a), await read(b)];
          // Only while a state signal has a value, if the pair says.
          const gateKey = pair.onlyWhile ? resolve(context, pair.onlyWhile.key) : null;
          const gate = gateKey ? await readSignal(settings, logId, gateKey, {}).catch(() => null) : null;
          const gateMissing = pair.onlyWhile && (!gate || gate.kind !== 'string') ? pair.onlyWhile.key : '';
          const within = pair.onlyWhile && gate && !gateMissing ? spansWhereText({ times: gate.times, values: gate.values as string[] }, pair.onlyWhile.value, spans) : spans;
          const compared = sa && sb && !gateMissing ? compareSymmetry(sa, sb, within, pair) : null;
          const info = a ? signals.get(a) : b ? signals.get(b) : undefined;
          rows.push({
            label: pair.label || `${labelOf(signals.get(a ?? ''), a ?? pair.a)} vs. ${labelOf(signals.get(b ?? ''), b ?? pair.b)}`,
            a: sa ? a : null,
            b: sb ? b : null,
            aLabel: a ? labelOf(signals.get(a), a) : pair.a,
            bLabel: b ? labelOf(signals.get(b), b) : pair.b,
            unit: info?.unit ?? '',
            condition: pair.onlyWhile && gateKey ? `while ${labelOf(signals.get(gateKey), gateKey)} is ${pair.onlyWhile.value}` : '',
            missing: gateMissing,
            seconds: compared?.seconds ?? 0,
            meanA: compared?.meanA ?? null,
            meanB: compared?.meanB ?? null,
            meanGap: compared?.meanGap ?? null,
            meanAbsGap: compared?.meanAbsGap ?? null,
            maxAbsGap: compared?.maxAbsGap ?? null,
            maxAt: compared?.maxAt ?? null
          });
        }
        sections.push({ type: 'symmetry', title: section.title, rows });
        break;
      }
    }
  }

  const label = logLabel(file);
  return {
    id: randomUUID(),
    name: `${template.name} · ${label}`,
    generated: new Date().toISOString(),
    by,
    templateId: template.id,
    template,
    logId,
    logLabel: label,
    robot: file.robot,
    match: file.match,
    spans,
    phases: review.phases,
    sections,
    problems,
    missing: [...context.missing]
  };
}

// --- Keeping reports ---

export async function saveReport(settings: Settings, report: Report): Promise<void> {
  const path = reportPath(settings, report.id);
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(`${path}.tmp`, JSON.stringify(report), 'utf-8');
  await fs.rename(`${path}.tmp`, path);
}

export async function loadReport(settings: Settings, id: string): Promise<Report | null> {
  try {
    const report = JSON.parse(await fs.readFile(reportPath(settings, id), 'utf-8')) as Report;
    return report && report.id === id && Array.isArray(report.sections) ? report : null;
  } catch {
    return null;
  }
}

// Summaries, newest first. Read from each report once per version.
const summaries = new Map<string, { version: string; summary: ReportSummary | null }>();

export async function listReports(settings: Settings): Promise<ReportSummary[]> {
  const folder = dirname(reportPath(settings, 'x'));
  const names = (await fs.readdir(folder).catch(() => [] as string[])).filter((n) => n.endsWith('.json'));
  const out: ReportSummary[] = [];
  for (const name of names) {
    const path = join(folder, name);
    const stat = await fs.stat(path).catch(() => null);
    if (!stat) continue;
    const version = `${stat.size}:${stat.mtimeMs}`;
    let known = summaries.get(path);
    if (known?.version !== version) {
      const report = await loadReport(settings, name.slice(0, -'.json'.length));
      known = { version, summary: report ? reportSummary(report) : null };
      summaries.set(path, known);
    }
    if (known.summary) out.push(known.summary);
  }
  // Only the newest report from each template for each log is kept: one
  // run again (by hand, or after its log grew) replaces the one before.
  const older = duplicateReports(out);
  for (const report of older) {
    await fs.rm(reportPath(settings, report.id), { force: true });
    summaries.delete(reportPath(settings, report.id));
  }
  const gone = new Set(older.map((report) => report.id));
  return out.filter((report) => !gone.has(report.id)).sort((a, b) => b.generated.localeCompare(a.generated));
}

export async function deleteReport(settings: Settings, id: string): Promise<void> {
  await fs.rm(reportPath(settings, id), { force: true });
}

// By hand, from the Reports page.
export async function generateReport(settings: Settings, templateId: string, logId: string): Promise<Report> {
  const template = await getLibraryItem(settings, 'template', templateId);
  if (!template) throw new Error('That template is gone.');
  const report = await makeReport(settings, template, logId, 'By hand');
  await saveReport(settings, report);
  return report;
}

// --- Pipelines ---

const status: PipelineStatus = { running: false, current: null, done: 0, total: 0, recent: [] };
const recentRuns = 30;

export function pipelineStatus(): PipelineStatus {
  return status;
}

export function pipelineApplies(pipeline: Pipeline, file: SignalLogFile, how: 'offload' | 'import' | 'manual'): boolean {
  if (how !== 'manual' && (!pipeline.enabled || (how === 'offload' ? !pipeline.onOffload : !pipeline.onImport))) return false;
  if (pipeline.robots.length && !pipeline.robots.includes(file.robot)) return false;
  if (pipeline.matchTypes.length && !pipeline.matchTypes.includes(file.match?.type ?? 'none')) return false;
  return true;
}

let queue: Promise<unknown> = Promise.resolve();

// How many logs' reports are made at once. The main process keeps this
// many logs open (signals-service), so they don't take turns loading.
const logsAtOnce = 3;

// Runs the pipelines that apply to each log: a log's reports all at once,
// a few logs at once. With `only`, just that pipeline (run by hand,
// whatever its triggers say).
export function runPipelines(logIds: string[], how: 'offload' | 'import' | 'manual', only?: string): Promise<PipelineRun[]> {
  const next = queue.then(async () => {
    const settings = await loadSettings();
    // The one auto report configuration (see theAutoReport), or the one asked for.
    const all = await listLibrary(settings, 'pipeline');
    const chosen = only ? all.find((p) => p.id === only) : theAutoReport(all);
    const pipelines = chosen ? [chosen] : [];
    let files = (await signalLogs(settings)).filter((log) => logIds.includes(log.id));
    // Several new logs at once: all, the newest, or none, as it says. Run by
    // hand, it runs on what it's asked to.
    if (how !== 'manual' && chosen) {
      const applies = files.filter((file) => pipelineApplies(chosen, file, how));
      if (applies.length > 1 && chosen.several === 'none') files = [];
      else if (applies.length > 1 && chosen.several === 'newest') files = [applies.reduce((a, b) => (b.recorded > a.recorded ? b : a))];
    }
    const runs: PipelineRun[] = [];
    const stopIfCancelled = cancelCheck();
    const making = new Set<string>();
    const showMaking = () => { status.current = making.size ? [...making].join('; ') : null; };
    status.running = true;

    const runOne = async (file: SignalLogFile, pipeline: Pipeline, templateId: string) => {
      const template = await getLibraryItem(settings, 'template', templateId);
      const run: PipelineRun = {
        at: new Date().toISOString(),
        pipeline: pipeline.name,
        template: template?.name ?? '(a template that is gone)',
        logId: file.id,
        logLabel: logLabel(file),
        reportId: null,
        problem: ''
      };
      const what = `${pipeline.name}: ${run.template} for ${run.logLabel}`;
      making.add(what);
      showMaking();
      try {
        stopIfCancelled();
        if (!template) throw new Error('The template is gone.');
        const report = await makeReport(settings, template, file.id, `Auto report: ${pipeline.name}`);
        await saveReport(settings, report);
        run.reportId = report.id;
      } catch (error) {
        run.problem = (error as Error).message;
      } finally {
        making.delete(what);
        showMaking();
        status.done += 1;
      }
      if (isCancelled({ message: run.problem })) return;
      runs.push(run);
      status.recent = [run, ...status.recent].slice(0, recentRuns);
    };

    // Every template runs (for any robot, or the log's): which ones isn't
    // chosen. A log's reports together: they share its open session.
    const templates = await listLibrary(settings, 'template');
    const forLog = (file: SignalLogFile) => pipelines
      .filter((pipeline) => pipelineApplies(pipeline, file, how))
      .flatMap((pipeline) => templates
        .filter((template) => !template.robot || template.robot === file.robot)
        .map((template) => ({ pipeline, template })));
    status.done = 0;
    status.total = files.reduce((total, file) => total + forLog(file).length, 0);
    const runLog = (file: SignalLogFile) => Promise.all(forLog(file).map(({ pipeline, template }) => runOne(file, pipeline, template.id)));

    try {
      let next = 0;
      const worker = async () => {
        while (next < files.length) {
          try {
            stopIfCancelled();
          } catch {
            return;
          }
          await runLog(files[next++]);
        }
      };
      await Promise.all(Array.from({ length: Math.min(logsAtOnce, files.length) }, worker));
    } finally {
      status.running = false;
      status.current = null;
      status.done = 0;
      status.total = 0;
    }
    return runs;
  });
  queue = next.catch(() => {});
  return next;
}

// The logs there are now, to tell which an offload or import added.
export async function logIdsNow(settings: Settings): Promise<Set<string>> {
  return new Set((await signalLogs(settings).catch(() => [])).map((log) => log.id));
}

// After a download or import, in the background: the new logs go through
// the auto reports, and logs whose files were pulled again because they
// grew (a log still being written when it was first pulled) have their
// reports run again.
export async function afterNewLogs(before: Set<string>, how: 'offload' | 'import', changed: string[] = [], handled: Set<string> = new Set()): Promise<void> {
  const settings = await loadSettings();
  if (changed.length > 0) {
    forgetFiles(changed);
    const grown = new Set(changed);
    const files = (session: SignalLogFile) => [session.localPath, ...session.hoots.map((h) => h.localPath), ...session.dsLogs.flatMap((d) => [d.localPath, d.eventsPath])];
    const logs = (await signalLogs(settings)).filter((log) => before.has(log.id) && files(log).some((path) => path !== null && grown.has(path)));
    if (logs.length > 0) rerunReports(logs.map((log) => log.id)).catch(() => {});
  }
  // Less those already run on as their match came in (afterMatchDownloaded).
  const added = [...(await logIdsNow(settings))].filter((id) => !before.has(id) && !handled.has(id));
  if (added.length === 0) return;
  const pipeline = theAutoReport(await listLibrary(settings, 'pipeline'));
  if (!pipeline?.enabled || !(how === 'offload' ? pipeline.onOffload : pipeline.onImport)) return;
  runPipelines(added, how).catch(() => {});
}

// While a download goes on: one match's files are all here, so its new
// logs go through the auto report now, not at the end of the download, in
// turn with any already running. `handled` collects the logs run on, which
// the end of the download (afterNewLogs) leaves out. When the download
// brings several matches and the auto report runs on only the newest of
// several (or none), it's left to the end, which knows them all.
export async function afterMatchDownloaded(before: Set<string>, handled: Set<string>, localPaths: string[], matches: number): Promise<void> {
  const settings = await loadSettings();
  const pipeline = theAutoReport(await listLibrary(settings, 'pipeline'));
  if (!pipeline?.enabled || !pipeline.onOffload) return;
  if (matches > 1 && pipeline.several !== 'all') return;
  const paths = new Set(localPaths);
  const files = (log: SignalLogFile) => [log.localPath, ...log.hoots.map((h) => h.localPath), ...log.dsLogs.flatMap((d) => [d.localPath, d.eventsPath])];
  const logs = (await signalLogs(settings)).filter((log) => !before.has(log.id) && !handled.has(log.id) && files(log).some((path) => path !== null && paths.has(path)));
  if (logs.length === 0) return;
  for (const log of logs) handled.add(log.id);
  runPipelines(logs.map((log) => log.id), 'offload').catch(() => {});
}

// Runs each of these logs' reports again, from the template each was made
// with (as it was then), after their logs grew. The new report replaces
// the old (see listReports). In turn with the auto reports, a log's
// reports at once and a few logs at once.
export function rerunReports(logIds: string[]): Promise<PipelineRun[]> {
  const next = queue.then(async () => {
    const settings = await loadSettings();
    const all = await listReports(settings);
    const files = new Map((await signalLogs(settings)).map((log) => [log.id, log]));
    const runs: PipelineRun[] = [];
    const stopIfCancelled = cancelCheck();
    status.running = true;
    const ids = logIds.filter((id) => files.has(id));
    status.done = 0;
    status.total = all.filter((r) => ids.includes(r.logId)).length;
    const runOne = async (summary: ReportSummary) => {
      const file = files.get(summary.logId);
      const run: PipelineRun = {
        at: new Date().toISOString(),
        pipeline: 'Run again (the log grew)',
        template: summary.templateName,
        logId: summary.logId,
        logLabel: file ? logLabel(file) : summary.logLabel,
        reportId: null,
        problem: ''
      };
      status.current = `${run.template} for ${run.logLabel} (run again: the log grew)`;
      try {
        stopIfCancelled();
        const old = await loadReport(settings, summary.id);
        if (!old) throw new Error('The report is gone.');
        const report = await makeReport(settings, old.template, summary.logId, old.by);
        await saveReport(settings, report);
        run.reportId = report.id;
      } catch (error) {
        run.problem = (error as Error).message;
      } finally {
        status.done += 1;
      }
      if (isCancelled({ message: run.problem })) return;
      runs.push(run);
      status.recent = [run, ...status.recent].slice(0, recentRuns);
    };
    try {
      let at = 0;
      const worker = async () => {
        while (at < ids.length) {
          try {
            stopIfCancelled();
          } catch {
            return;
          }
          const id = ids[at++];
          await Promise.all(all.filter((r) => r.logId === id).map(runOne));
        }
      };
      await Promise.all(Array.from({ length: Math.min(logsAtOnce, ids.length) }, worker));
      // The old ones go now, not at the next look at the list.
      await listReports(settings);
    } finally {
      status.running = false;
      status.current = null;
      status.done = 0;
      status.total = 0;
    }
    return runs;
  });
  queue = next.catch(() => {});
  return next;
}

// --- Exporting and importing reports ---

// Every report (the newest of each, as listed), into a new folder in
// `into`: a PDF of each, and each report's own JSON under reports/, as the
// data folder keeps it, which Import reports reads back. One PDF at a time:
// each is drawn in a window of its own.
export async function exportReports(settings: Settings, into: string, pdfOf: (report: Report) => Promise<Buffer>): Promise<ReportExport> {
  const reports = (await Promise.all((await listReports(settings)).map((summary) => loadReport(settings, summary.id))))
    .filter((report): report is Report => report !== null);
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '');
  const folder = join(into, `Diagnostics reports ${stamp}`);
  await fs.mkdir(join(folder, 'reports'), { recursive: true });
  const names = reportFileNames(reports);
  const errors: string[] = [];
  let count = 0;
  for (const report of reports) {
    try {
      await fs.writeFile(join(folder, 'reports', `${report.id}.json`), JSON.stringify(report), 'utf-8');
      await fs.writeFile(join(folder, names.get(report.id)!), await pdfOf(report));
      count += 1;
    } catch (error) {
      errors.push(`${report.name}: ${(error as Error).message}`);
    }
  }
  await fs.writeFile(join(folder, 'README.txt'), [
    'Reports exported from Greybots Diagnostics.',
    '',
    'Each report is here as a PDF, to read or share, and its data is under',
    'reports/ (one .json file each), as the app keeps it. To bring them into',
    'Greybots Diagnostics on another computer: Reports > Import reports, and',
    'pick the .json files in reports/.',
    ''
  ].join('\r\n'), 'utf-8');
  return { folder, count, errors };
}

// Reports from .json files (an export's reports/, or another data folder's),
// into this data folder. Each is checked first. One with the same id is
// already here; a newer run of the same report replaces an older one (see
// listReports).
const maxReportBytes = 100 * 1024 * 1024;

export async function importReports(settings: Settings, paths: string[]): Promise<ReportImport> {
  const result: ReportImport = { imported: 0, already: 0, invalid: [] };
  for (const path of paths) {
    const name = path.split(/[\/]/).pop() ?? path;
    try {
      const stat = await fs.stat(path);
      if (!stat.isFile() || stat.size > maxReportBytes) throw new Error('not a report');
      const raw: unknown = JSON.parse(await fs.readFile(path, 'utf-8'));
      if (!isReport(raw)) throw new Error('not a report');
      if (await loadReport(settings, raw.id)) {
        result.already += 1;
        continue;
      }
      await saveReport(settings, raw);
      result.imported += 1;
    } catch {
      result.invalid.push(name);
    }
  }
  await listReports(settings);
  return result;
}
