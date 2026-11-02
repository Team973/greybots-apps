// Events found in a log's signals, for review (#94): brownouts, CAN errors,
// loop overruns, alerts, console errors, enables and the match's phases;
// and from Hoot logs, device faults. Found by the signals' names, the way
// WPILib, DogLog, AdvantageKit and CTRE log them, so they turn up for any
// robot without the app knowing its code.

import {
  endgameSeconds,
  mergeSpans,
  type EventKind,
  type EventSeverity,
  type LogEvent,
  type MatchPhase
} from '@shared/events';
import { valueAtTime, type SignalSeries } from '@shared/signals';
import type { LogSignalSource } from './log-source';
import type { LogValue } from './wpilog';

interface Span {
  start: number;
  end: number | null;
}

// Events of one kind and title, from its spans: ones close together are one.
export function eventsFrom(kind: EventKind, severity: EventSeverity, title: string, spans: Span[],
  options: { key?: string | null; detail?: (count: number, span: Span) => string } = {}): LogEvent[] {
  return mergeSpans(spans).map((span) => ({
    id: `${kind}:${title}:${span.start.toFixed(3)}`,
    kind,
    severity,
    start: span.start,
    end: span.end,
    title,
    detail: options.detail?.(span.count, span) ?? (span.count > 1 ? `${span.count} times` : ''),
    count: span.count,
    key: options.key ?? null
  }));
}

// Where a series' values pass a test, as spans. One still passing at the
// end of the log runs to its last value.
export function spansWhere(series: SignalSeries | null, test: (value: number) => boolean, end: number): Span[] {
  if (!series) return [];
  const values = series.values as Float64Array;
  const spans: Span[] = [];
  let from: number | null = null;
  for (let i = 0; i < values.length; i++) {
    const passes = test(values[i]);
    if (passes && from === null) from = series.times[i];
    if (!passes && from !== null) {
      spans.push({ start: from, end: series.times[i] });
      from = null;
    }
  }
  if (from !== null) spans.push({ start: from, end: Math.max(from, end) });
  return spans;
}

// Moments a counter went up, with what it went up to.
function increases(series: SignalSeries | null): { start: number; end: null; value: number }[] {
  if (!series) return [];
  const values = series.values as Float64Array;
  const out = [];
  for (let i = 1; i < values.length; i++) if (values[i] > values[i - 1]) out.push({ start: series.times[i], end: null, value: values[i] });
  return out;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const busName = (key: string) => (/canivore/i.test(key) ? 'CANivore' : 'roboRIO CAN bus');

// --- From a data log ---

function brownouts(source: LogSignalSource, end: number): LogEvent[] {
  return source.catalog()
    .filter((s) => s.kind === 'boolean' && s.count > 0 && /brown(ed)?.?out$/i.test(s.key))
    .flatMap((s) => eventsFrom('brownout', 'error', 'Brownout', spansWhere(source.read(s.key), (v) => v === 1, end), { key: s.key }));
}

function canErrors(source: LogSignalSource, end: number): LogEvent[] {
  const out: LogEvent[] = [];
  for (const signal of source.catalog()) {
    if (signal.kind !== 'number' || signal.count === 0) continue;
    const key = signal.key;
    const errors = /(can|bus)[^/]*\/(receive|transmit)errorcount$/i.exec(key);
    if (errors) {
      const series = source.read(key);
      const values = series?.values as Float64Array | undefined;
      const spans = spansWhere(series, (v) => v > 0, end);
      // The most errors counted in each.
      const most = (span: Span) => {
        let max = 0;
        if (series && values) for (let i = 0; i < values.length; i++) if (series.times[i] >= span.start && series.times[i] <= (span.end ?? span.start)) max = Math.max(max, values[i]);
        return max;
      };
      out.push(...eventsFrom('can', 'warning', `${busName(key)}: ${errors[2].toLowerCase()} errors`, spans, {
        key,
        detail: (count, span) => `Up to ${plural(most(span), 'error')}${count > 1 ? `, ${count} times` : ''}`
      }));
    } else if (/off.?count$/i.test(key) && /can|bus/i.test(key)) {
      out.push(...eventsFrom('can', 'error', `${busName(key)}: bus off`, increases(source.read(key)), { key }));
    } else if (/tx.?full.?count$/i.test(key)) {
      out.push(...eventsFrom('can', 'warning', `${busName(key)}: transmit buffer full`, increases(source.read(key)), { key }));
    }
  }
  return out;
}

const messageGroupLength = 40;

// Lines of the robot program's console output (DataLogManager logs it as
// `console`; DriverStation messages as `messages`).
function consoleEvents(source: LogSignalSource): LogEvent[] {
  const overruns: Span[] = [];
  const grouped = new Map<string, { kind: EventKind; severity: EventSeverity; texts: Set<string>; spans: Span[]; key: string }>();
  // Messages that differ only in their numbers, or past their start (which
  // entry was dropped, which file), are one.
  const add = (kind: EventKind, severity: EventSeverity, text: string, time: number, key: string) => {
    const id = `${kind}:${severity}:${text.replace(/\d+(\.\d+)?/g, '#').slice(0, messageGroupLength)}`;
    const group = grouped.get(id) ?? { kind, severity, texts: new Set(), spans: [], key };
    group.texts.add(text);
    group.spans.push({ start: time, end: null });
    grouped.set(id, group);
  };

  for (const key of ['console', 'messages']) {
    const series = source.catalog().some((s) => s.key === key && s.kind === 'string') ? source.read(key) : null;
    if (!series) continue;
    (series.values as string[]).forEach((text, i) => {
      const time = series.times[i];
      for (const line of text.split(/\r?\n/)) {
        // Stack traces and the tracer's timings, under the line that matters.
        if (/^\s/.test(line) || /Tracer\.|printEpochs/.test(line)) continue;
        if (/loop time of [\d.]+\s*s overrun|loop overrun/i.test(line)) {
          overruns.push({ start: time, end: null });
          continue;
        }
        const disconnected = /^NT: DISCONNECTED NT\d? client '([^'@]+)[^']*'.*?:\s*(.*)$/.exec(line);
        if (disconnected) {
          add('network', 'info', `${disconnected[1]} left NetworkTables (${disconnected[2]})`, time, key);
          continue;
        }
        const reported = /^(Error|ERROR|Warning|WARNING)\b(?: at [^:]*\([^)]*\))?:?\s*(.*)$/.exec(line);
        if (reported && reported[2]) {
          const message = reported[2].trim();
          // Numbers aside, the same message is one event.
          add('message', /^e/i.test(reported[1]) ? 'error' : 'warning', message, time, key);
        }
      }
    });
  }

  const out = eventsFrom('overrun', 'warning', 'Loop overrun', overruns, { key: 'console' });
  for (const group of grouped.values()) {
    const texts = [...group.texts];
    // What they have in common, to a word's end, when they differ.
    let title = texts[0];
    if (texts.length > 1) {
      let same = 0;
      while (texts.every((t) => t[same] === title[same]) && same < title.length) same++;
      title = `${title.slice(0, same).replace(/\s+\S*$/, '').replace(/[\s,:;]+$/, '')}…`;
    }
    out.push(...eventsFrom(group.kind, group.severity, title.length > 120 ? `${title.slice(0, 119)}…` : title, group.spans, {
      key: group.key,
      detail: (count) => [count > 1 ? `${count} times` : '', texts.length > 1 || texts[0].length > 120 ? `e.g. ${texts[0]}` : '']
        .filter(Boolean).join(' · ')
    }));
  }
  return out;
}

// WPILib's Alerts (errors, warnings, infos: lists of what's active) and
// DogLog's faults: each from when it's in the list until it isn't.
function alerts(source: LogSignalSource, end: number): LogEvent[] {
  const out: LogEvent[] = [];
  for (const signal of source.catalog()) {
    const list = /alerts\/(errors|warnings|infos)$/i.exec(signal.key) ?? (/faults\/active$/i.test(signal.key) ? [signal.key, 'errors'] : null);
    if (!list || signal.type !== 'string[]') continue;
    const severity: EventSeverity = list[1].toLowerCase() === 'errors' ? 'error' : list[1].toLowerCase() === 'warnings' ? 'warning' : 'info';
    const raw = source.readValues(signal.key);
    if (!raw) continue;
    const open = new Map<string, number>();
    const spans = new Map<string, Span[]>();
    const close = (text: string, at: number) => {
      spans.set(text, [...(spans.get(text) ?? []), { start: open.get(text)!, end: at }]);
      open.delete(text);
    };
    raw.values.forEach((value: LogValue, i) => {
      const now = new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
      for (const text of now) if (!open.has(text)) open.set(text, raw.times[i]);
      for (const text of [...open.keys()]) if (!now.has(text)) close(text, raw.times[i]);
    });
    for (const text of [...open.keys()]) close(text, Math.max(open.get(text)!, end));
    for (const [text, list] of spans) out.push(...eventsFrom('alert', severity, text, list, { key: signal.key }));
  }
  return out;
}

export function dataLogEvents(source: LogSignalSource): LogEvent[] {
  const end = source.lastTime - source.firstTime;
  return withoutRepeats([...brownouts(source, end), ...canErrors(source, end), ...consoleEvents(source), ...alerts(source, end)]);
}

// The same thing logged twice (DogLog reports its faults as WPILib alerts
// too) is one event.
export function withoutRepeats(events: LogEvent[]): LogEvent[] {
  const kept: LogEvent[] = [];
  for (const event of [...events].sort((a, b) => a.start - b.start)) {
    if (!kept.some((k) => k.kind === event.kind && k.title === event.title && Math.abs(k.start - event.start) < 1)) kept.push(event);
  }
  return kept;
}

// --- Enables, modes and phases ---

export type RobotMode = 'disabled' | 'auto' | 'teleop' | 'test';

export interface ModeChange {
  time: number;
  mode: RobotMode;
}

const enabledPattern = /(^|[/:])(ds:)?enabled$|driverstation\/enabled$/i;
const autoPattern = /(^|[/:])(ds:)?autonomous$|driverstation\/autonomous$|isauto(nomous)?(enabled)?$/i;
const teleopPattern = /driverstation\/teleop$|isteleop(enabled)?$/i;
const testPattern = /(^|[/:])(ds:)?test$|driverstation\/test$|istest(enabled)?$/i;

// Whether a data log says, from the Driver Station's own record (WPILib's
// DS: entries, AdvantageKit's DriverStation/), when it was enabled.
export function hasDriverStationEnable(source: LogSignalSource): boolean {
  return source.catalog().some((s) => s.kind === 'boolean' && s.count > 0 && enabledPattern.test(s.key));
}

// The mode over time from a data log, or null if it doesn't say. Without
// the Driver Station's enable, robot code's own "auto enabled" and "teleop
// enabled" flags do.
export function dataLogModes(source: LogSignalSource): ModeChange[] | null {
  const find = (pattern: RegExp) => {
    const signal = source.catalog().find((s) => s.kind === 'boolean' && s.count > 0 && pattern.test(s.key));
    return signal ? source.read(signal.key) : null;
  };
  const enabled = find(enabledPattern);
  const auto = find(autoPattern);
  const teleop = find(teleopPattern);
  const test = find(testPattern);
  if (!enabled && !auto && !teleop) return null;

  const at = (series: SignalSeries | null, t: number) => !!series && valueAtTime(series, t) === 1;
  const times = [...new Set([enabled, auto, teleop, test].flatMap((s) => (s ? [...s.times] : [])))].sort((a, b) => a - b);
  const changes: ModeChange[] = [];
  for (const t of times) {
    const isAuto = at(auto, t);
    const isTest = at(test, t);
    const on = enabled ? at(enabled, t) : isAuto || at(teleop, t) || isTest;
    const mode: RobotMode = !on ? 'disabled' : isAuto ? 'auto' : isTest ? 'test' : 'teleop';
    if (changes[changes.length - 1]?.mode !== mode) changes.push({ time: t, mode });
  }
  return changes;
}

// CTRE's RobotMode, from a Hoot log ('Disabled', 'Autonomous', 'Teleop', 'Test').
export function hootModes(series: SignalSeries | null, offset: number): ModeChange[] | null {
  if (!series || series.kind !== 'string' || series.times.length === 0) return null;
  const changes: ModeChange[] = [];
  (series.values as string[]).forEach((value, i) => {
    const mode: RobotMode = /auto/i.test(value) ? 'auto' : /teleop/i.test(value) ? 'teleop' : /test/i.test(value) ? 'test' : 'disabled';
    if (changes[changes.length - 1]?.mode !== mode) changes.push({ time: series.times[i] + offset, mode });
  });
  return changes;
}

const modeNames: Record<RobotMode, string> = { disabled: 'Disabled', auto: 'Autonomous', teleop: 'Teleop', test: 'Test' };

export function modeEvents(changes: ModeChange[], key: string | null): LogEvent[] {
  // The log starting disabled isn't an event.
  return changes.filter((change, i) => i > 0 || change.mode !== 'disabled').map((change) => ({
    id: `mode:${change.mode}:${change.time.toFixed(3)}`,
    kind: 'mode',
    severity: 'info',
    start: change.time,
    end: null,
    title: change.mode === 'disabled' ? 'Disabled' : `Enabled: ${modeNames[change.mode]}`,
    detail: '',
    count: 1,
    key
  }));
}

// Auto and teleop where the robot was enabled in them; in a match, the end
// of teleop is its endgame. A brief drop (a dropped packet) doesn't split one.
export function matchPhases(changes: ModeChange[], end: number, inMatch: boolean): MatchPhase[] {
  const phases: MatchPhase[] = [];
  changes.forEach((change, i) => {
    if (change.mode !== 'auto' && change.mode !== 'teleop') return;
    const until = changes[i + 1]?.time ?? end;
    const last = phases[phases.length - 1];
    if (last && last.name === change.mode && change.time - last.end <= 2) last.end = until;
    else phases.push({ name: change.mode, start: change.time, end: until });
  });
  if (inMatch) {
    for (const teleop of phases.filter((p) => p.name === 'teleop' && p.end - p.start > endgameSeconds * 2)) {
      phases.push({ name: 'endgame', start: teleop.end - endgameSeconds, end: teleop.end });
    }
  }
  return phases.sort((a, b) => a.start - b.start);
}

// --- Device faults, from Hoot logs ---

// Faults that are a device doing as it was told (a current limit holding,
// a limit switch) are worth seeing but aren't trouble.
const routineFaults = /CurrLimit|StaticBrakeDisabled|(Forward|Reverse)(Hard|Soft)Limit$/;
const warningFaults = /Unlicensed|DeviceTemp|ProcTemp|LoopTimeSlow|DataAcquiredLate|Saturated/;

const faultWords: Record<string, string> = {
  ProcTemp: 'processor temperature',
  DeviceTemp: 'device temperature',
  StatorCurrLimit: 'stator current limit',
  SupplyCurrLimit: 'supply current limit',
  OverSupplyV: 'supply voltage too high',
  UnstableSupplyV: 'supply voltage unstable',
  BridgeBrownout: 'bridge brownout',
  BootDuringEnable: 'rebooted while enabled',
  BadMagnet: 'magnet out of range'
};

export function faultSeverity(fault: string): EventSeverity {
  return routineFaults.test(fault) ? 'info' : warningFaults.test(fault) ? 'warning' : 'error';
}

// `TalonFX-59/Fault_SupplyCurrLimit` -> "TalonFX-59: supply current limit".
export function faultTitle(name: string): string {
  const [device, field] = name.split('/');
  const fault = field.replace(/^Fault_/, '');
  const words = faultWords[fault] ?? fault.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').toLowerCase();
  return `${device}: ${words}`;
}
