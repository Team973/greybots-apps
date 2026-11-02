// Reports (#148): a template run over a log. What it shows is read once,
// when it's made, and kept with it in the data folder's reports/, so a
// report reads the same later, whatever becomes of the log or template.
// Pipelines make them for new logs as they're offloaded or imported.

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

import { phaseLabels, type LogEvent, type MatchPhase, type SessionEvents } from '@shared/events';
import type { SignalLogFile } from '@shared/ipc';
import {
  reportSummary,
  templateKeys,
  type Pipeline,
  type RenderedSection,
  type Report,
  type ReportLine,
  type ReportScope,
  type ReportStatsRow,
  type ReportSummary,
  type ReportTemplate,
  type ViewSpan
} from '@shared/library';
import { describeMatch } from '@shared/offload';
import type { PipelineRun, PipelineStatus } from '@shared/reports';
import type { Settings } from '@shared/settings';
import { matchKey, type KeyMatch } from '@shared/signal-match';
import type { SignalInfo, SignalSeries } from '@shared/signals';
import { reportPathSegments } from '@shared/storage-layout';
import { getLibraryItem, listLibrary } from './library-store';
import { loadNotes } from './notes-store';
import { loadSettings } from './settings-store';
import { hootStatus, openSignalLog, readSignal, sessionEvents, signalLogs } from './signals-service';
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
  mapping: Record<string, string | null> | undefined;
  matches: Map<string, KeyMatch>;
  missing: Set<string>;
  whole: [number, number];
  review: SessionEvents;
}

function resolve(context: Context, wanted: string): string | null {
  let match = context.matches.get(wanted);
  if (!match) {
    match = matchKey(wanted, context.available, context.mapping);
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

const formatSeconds = (s: number) => (s >= 120 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${s.toFixed(1)} s`);

// Battery, from whichever signal the log calls it.
const batteryPattern = /(^|\/)(battery ?voltage|batteryvoltage|vbat|batteryvolts)$/i;

async function summaryFacts(context: Context, file: SignalLogFile, spans: [number, number][], events: LogEvent[]) {
  const facts: { label: string; value: string }[] = [];
  const span = spans.reduce((t, [s, e]) => t + (e - s), 0);
  facts.push({ label: 'Log', value: logLabel(file) });
  facts.push({ label: 'Robot', value: file.robot || '—' });
  facts.push({ label: 'Span', value: spans.length > 1 ? `${formatSeconds(span)} in ${spans.length} stretches` : `${spans[0][0].toFixed(1)}–${spans[0][1].toFixed(1)} s (${formatSeconds(span)})` });
  for (const phase of context.review.phases) {
    facts.push({ label: phaseLabels[phase.name], value: `${phase.start.toFixed(1)}–${phase.end.toFixed(1)} s` });
  }
  facts.push({ label: 'Errors', value: String(events.filter((e) => e.severity === 'error').length) });
  facts.push({ label: 'Warnings', value: String(events.filter((e) => e.severity === 'warning').length) });
  facts.push({ label: 'Brownouts', value: String(events.filter((e) => e.kind === 'brownout').reduce((n, e) => n + e.count, 0)) });
  const battery = context.available.find((key) => batteryPattern.test(key));
  if (battery) {
    const stats = await statsOver(context, battery, spans);
    if (stats) facts.push({ label: 'Battery', value: `${stats.min.toFixed(2)} V lowest, ${stats.mean.toFixed(2)} V on average` });
  }
  return facts;
}

const isRoutine = (event: LogEvent) => event.severity === 'info' && !['mode', 'note', 'state', 'command'].includes(event.kind);

async function waitForSession(settings: Settings, logId: string): Promise<SessionEvents> {
  const until = Date.now() + waitForHootMs;
  // Hoot logs lined up first: until then the timeline and catalog aren't whole.
  while (Date.now() < until) {
    const status = await hootStatus(settings, logId);
    if (!status.hoots.some((h) => h.state === 'opening') && status.progress === null) break;
    await sleep(500);
  }
  let review = await sessionEvents(settings, logId);
  while (review.pending && Date.now() < until) {
    await sleep(1000);
    review = await sessionEvents(settings, logId);
  }
  return review;
}

export async function makeReport(settings: Settings, template: ReportTemplate, logId: string, by: string): Promise<Report> {
  const file = (await signalLogs(settings)).find((log) => log.id === logId);
  if (!file) throw new Error('That log is not in the data folder.');
  const review = await waitForSession(settings, logId);
  const summary = await openSignalLog(settings, logId);
  const status = await hootStatus(settings, logId);
  const signals = new Map(summary.signals.map((s) => [s.key, s]));
  const mapping = (await listLibrary(settings, 'mapping')).find((m) => m.robot === file.robot)?.fields;
  const context: Context = {
    settings,
    logId,
    signals,
    available: summary.signals.filter((s) => s.kind !== 'other' && s.count !== 0).map((s) => s.key),
    mapping,
    matches: new Map(),
    missing: new Set(),
    whole: [status.start, status.end],
    review
  };
  // The cache of matches starts with every signal the template asks for.
  for (const key of templateKeys(template.sections, template.scope)) resolve(context, key);

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

  const sections: RenderedSection[] = [];
  for (const section of template.sections) {
    switch (section.type) {
      case 'heading':
      case 'text':
        sections.push(section);
        break;
      case 'summary':
        sections.push({ type: 'summary', facts: await summaryFacts(context, file, spans, events) });
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
      case 'events': {
        const chosen = events.filter((e) =>
          (section.kinds.length === 0 || section.kinds.includes(e.kind)) &&
          (section.problemsOnly ? e.severity === 'error' || e.severity === 'warning' : !isRoutine(e)));
        sections.push({ type: 'events', title: section.title, events: chosen });
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
  return out.sort((a, b) => b.generated.localeCompare(a.generated));
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

const status: PipelineStatus = { running: false, current: null, recent: [] };
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

// Runs the pipelines that apply to each log, one report at a time. With
// `only`, just that pipeline (run by hand, whatever its triggers say).
export function runPipelines(logIds: string[], how: 'offload' | 'import' | 'manual', only?: string): Promise<PipelineRun[]> {
  const next = queue.then(async () => {
    const settings = await loadSettings();
    const pipelines = (await listLibrary(settings, 'pipeline')).filter((p) => !only || p.id === only);
    const files = (await signalLogs(settings)).filter((log) => logIds.includes(log.id));
    const runs: PipelineRun[] = [];
    status.running = true;
    try {
      for (const file of files) {
        for (const pipeline of pipelines) {
          if (!pipelineApplies(pipeline, file, how)) continue;
          for (const templateId of pipeline.templateIds) {
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
            status.current = `${pipeline.name}: ${run.template} for ${run.logLabel}`;
            try {
              if (!template) throw new Error('The template is gone.');
              const report = await makeReport(settings, template, file.id, `Pipeline: ${pipeline.name}`);
              await saveReport(settings, report);
              run.reportId = report.id;
            } catch (error) {
              run.problem = (error as Error).message;
            }
            runs.push(run);
            status.recent = [run, ...status.recent].slice(0, recentRuns);
          }
        }
      }
    } finally {
      status.running = false;
      status.current = null;
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

// After an offload or import: the new logs go through the pipelines, in
// the background.
export async function afterNewLogs(before: Set<string>, how: 'offload' | 'import'): Promise<void> {
  const settings = await loadSettings();
  const added = [...(await logIdsNow(settings))].filter((id) => !before.has(id));
  if (added.length === 0) return;
  const pipelines = await listLibrary(settings, 'pipeline');
  if (!pipelines.some((p) => p.enabled && (how === 'offload' ? p.onOffload : p.onImport))) return;
  runPipelines(added, how).catch(() => {});
}
