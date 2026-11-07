// Events found in a log's signals, for review (#94): brownouts, CAN errors,
// loop overruns, alerts, console errors, enables and the match's phases;
// and from Hoot logs, device faults. Found by the signals' names, the way
// WPILib, DogLog, AdvantageKit and CTRE log them, so they turn up for any
// robot without the app knowing its code.

import {
  endgameSeconds,
  mergeGapSeconds,
  mergeSpans,
  type EventKind,
  type EventSeverity,
  type LogEvent,
  type MatchPhase
} from '@shared/events';
import { valueAtTime, type SignalSeries } from '@shared/signals';
import type { DsLog, DsMessage } from './ds-log';
import type { LogSignalSource } from './log-source';
import type { LogValue } from './wpilog';

interface Span {
  start: number;
  end: number | null;
}

// Events of one kind and title, from its spans: ones close together are one.
export function eventsFrom(kind: EventKind, severity: EventSeverity, title: string, spans: Span[],
  options: { key?: string | null; detail?: (count: number, span: Span) => string; gap?: number } = {}): LogEvent[] {
  return mergeSpans(spans, options.gap).map((span) => ({
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

// Output from the robot program's console, a line or several at a time.
export interface ConsoleText {
  time: number;
  text: string;
  // The signal it's in, if any.
  key: string | null;
  // Who said it, when that's not in the text as words (a device): messages
  // from different ones are never one event.
  from?: string;
}

// Lines of the robot program's console output (DataLogManager logs it as
// `console`; DriverStation messages as `messages`).
function consoleEvents(source: LogSignalSource): LogEvent[] {
  const texts: ConsoleText[] = [];
  for (const key of ['console', 'messages']) {
    const series = source.catalog().some((s) => s.key === key && s.kind === 'string') ? source.read(key) : null;
    if (!series) continue;
    (series.values as string[]).forEach((text, i) => texts.push({ time: series.times[i], text, key }));
  }
  return consoleTextEvents(texts);
}

// Whether a data log has the robot's console: then a Driver Station log's
// copy of it isn't needed.
export function hasConsole(source: LogSignalSource): boolean {
  return source.catalog().some((s) => (s.key === 'console' || s.key === 'messages') && s.kind === 'string' && s.count > 0);
}

export function consoleTextEvents(texts: ConsoleText[], gap = mergeGapSeconds): LogEvent[] {
  const overruns: Span[] = [];
  const grouped = new Map<string, { kind: EventKind; severity: EventSeverity; texts: Set<string>; spans: Span[]; key: string | null }>();
  // Messages that differ only in their numbers, or past their start (which
  // entry was dropped, which file), are one.
  const add = (kind: EventKind, severity: EventSeverity, text: string, time: number, key: string | null, from = '') => {
    const id = `${kind}:${severity}:${from}:${text.replace(/\d+(\.\d+)?/g, '#').slice(0, messageGroupLength)}`;
    const group = grouped.get(id) ?? { kind, severity, texts: new Set(), spans: [], key };
    group.texts.add(text);
    group.spans.push({ start: time, end: null });
    grouped.set(id, group);
  };

  let overrunKey: string | null = null;
  for (const { time, text, key, from } of [...texts].sort((a, b) => a.time - b.time)) {
    for (const line of text.split(/\r?\n/)) {
      // Stack traces and the tracer's timings, under the line that matters.
      if (/^\s/.test(line) || /Tracer\.|printEpochs/.test(line)) continue;
      if (/loop time of [\d.]+\s*s overrun|loop overrun/i.test(line)) {
        // An overrun's said twice (the robot loop's and the command scheduler's).
        if (overruns.length === 0 || time - overruns[overruns.length - 1].start > 0.05) overruns.push({ start: time, end: null });
        overrunKey ??= key;
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
        add('message', /^e/i.test(reported[1]) ? 'error' : 'warning', message, time, key, from);
      }
    }
  }

  const out = eventsFrom('overrun', 'warning', 'Loop overrun', overruns, { key: overrunKey, gap });
  for (const group of grouped.values()) {
    const texts = [...group.texts];
    // When they differ: only in their numbers, the numbers that differ as
    // #; otherwise what they have in common, to a word's end.
    let title = texts[0];
    const pieces = texts.map((t) => t.split(/(\d+(?:\.\d+)?)/));
    if (texts.length > 1 && pieces.every((p) => p.length === pieces[0].length && p.every((piece, i) => i % 2 === 1 || piece === pieces[0][i]))) {
      title = pieces[0].map((piece, i) => (i % 2 === 1 && pieces.some((p) => p[i] !== piece) ? '#' : piece)).join('');
    } else if (texts.length > 1) {
      let same = 0;
      while (texts.every((t) => t[same] === title[same]) && same < title.length) same++;
      title = `${title.slice(0, same).replace(/\s+\S*$/, '').replace(/[\s,:;]+$/, '')}…`;
    }
    out.push(...eventsFrom(group.kind, group.severity, title.length > 120 ? `${title.slice(0, 119)}…` : title, group.spans, {
      key: group.key,
      gap,
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

// Subsystems' states, where robot code logs them as text: `intake/state`,
// `superstructure/wantedState`, `arm/CurrentState`.
const statePattern = /(^|\/)((current|wanted|desired|goal|requested)[ _]?)?state$/i;

function stateEvents(source: LogSignalSource): LogEvent[] {
  const out: LogEvent[] = [];
  for (const signal of source.catalog()) {
    const named = statePattern.exec(signal.key);
    if (signal.kind !== 'string' || signal.count < 2 || !named) continue;
    const series = source.read(signal.key);
    if (!series) continue;
    const parts = signal.key.split('/').filter(Boolean);
    const owner = parts.length > 1 ? parts[parts.length - 2] : 'State';
    const which = named[3] ? ` (${named[3].toLowerCase()})` : '';
    const values = series.values as string[];
    // Each change; the value it starts with isn't one.
    for (let i = 1; i < values.length; i++) {
      if (values[i] === values[i - 1]) continue;
      out.push({
        id: `state:${signal.key}:${series.times[i].toFixed(3)}`,
        kind: 'state',
        severity: 'info',
        start: series.times[i],
        end: null,
        title: `${owner}${which}: ${values[i]}`,
        detail: `from ${values[i - 1]}`,
        count: 1,
        key: signal.key
      });
    }
  }
  return out;
}

// A driver's or operator's controller, as robot code names it.
const controllerPattern = /^((driver|operator|co-?driver|manipulator)[ _-]?(stick|controller|gamepad|joystick|xbox|pad)|(stick|gamepad|joystick|xbox)[ _-]?\d*)$/i;
// WPILib's DriverStation log and AdvantageKit's: a joystick's buttons as bits.
const buttonBitsPattern = /joystick ?(\d+)\/button(s|values)$/i;

// Buttons pressed: each from press to release. Ones pressed again and
// again (a trigger held on and off) are one, with a count.
function commandEvents(source: LogSignalSource, end: number): LogEvent[] {
  const out: LogEvent[] = [];
  for (const signal of source.catalog()) {
    if (signal.count === 0) continue;
    const parts = signal.key.split('/').filter(Boolean);
    const controller = parts.findIndex((p) => controllerPattern.test(p));
    if (signal.kind === 'boolean' && controller !== -1 && controller < parts.length - 1) {
      const button = parts.slice(controller + 1).join(' / ');
      // Robot code's "pressed" and "released" edges, and whether it's plugged in, aren't presses.
      if (/(pressed|released|connected)$/i.test(button)) continue;
      out.push(...eventsFrom('command', 'info', `${parts[controller]}: ${button}`, spansWhere(source.read(signal.key), (v) => v === 1, end), { key: signal.key }));
      continue;
    }
    const bits = buttonBitsPattern.exec(signal.key);
    if (bits && signal.kind === 'number') {
      const series = source.read(signal.key);
      if (!series) continue;
      for (let button = 0; button < 32; button++) {
        const spans = spansWhere(series, (v) => ((v >>> button) & 1) === 1, end);
        out.push(...eventsFrom('command', 'info', `Joystick ${bits[1]}: button ${button + 1}`, spans, { key: signal.key }));
      }
    }
  }
  return out;
}

export function dataLogEvents(source: LogSignalSource): LogEvent[] {
  const end = source.lastTime - source.firstTime;
  return withoutRepeats([
    ...brownouts(source, end),
    ...canErrors(source, end),
    ...consoleEvents(source),
    ...alerts(source, end),
    ...stateEvents(source),
    ...commandEvents(source, end)
  ]);
}

// --- From a Driver Station log ---

// The Driver Station's own messages that say nothing a DS log doesn't
// (lost communication, Enter pressed to disable) or nothing of use (time
// since boot, when the radio was seen).
const quietDsCodes = new Set([44004, 44000, 44007, 44008]);

// Events in a Driver Station log and its .dsevents, on its own timeline.
// With `robotConsole`, the data log has the robot's console, so the
// robot's messages here (a copy) are left out.
export function dsLogEvents(log: DsLog, messages: DsMessage[], options: { robotConsole: boolean; key: (name: string) => string }): LogEvent[] {
  const { key } = options;
  const out: LogEvent[] = [
    ...eventsFrom('brownout', 'error', 'Brownout', log.brownouts, { key: key('Brownout') }),
    ...eventsFrom('network', 'error', 'Lost communication with the robot while enabled', log.lost.filter((l) => l.enabled), { key: key('Robot connected') }),
    ...eventsFrom('network', 'info', 'Robot disconnected', log.lost.filter((l) => !l.enabled), { key: key('Robot connected') }),
    ...eventsFrom('network', 'warning', 'Poor connection', log.poorLink, {
      key: key('Packet loss'),
      detail: (count, span) => {
        const inside = log.poorLink.filter((p) => p.start >= span.start && p.start <= (span.end ?? span.start));
        const loss = Math.max(...inside.map((p) => p.loss));
        const trip = Math.max(...inside.map((p) => p.trip));
        return [`Up to ${loss}% packets lost, ${trip} ms trip time`, count > 1 ? `${count} times` : ''].filter(Boolean).join(' · ');
      }
    })
  ];

  const texts: ConsoleText[] = [];
  for (const message of messages) {
    if (message.from === 'ds' && quietDsCodes.has(message.code)) continue;
    if (message.from === 'robot' && options.robotConsole) continue;
    // Printed lines are console output as it was; errors and warnings
    // reported are printed too ("Warning at ..."), so they're read from
    // their report instead, with where they came from.
    if (message.severity === 'printed') {
      if (message.from === 'robot' && !/^(Error|ERROR|Warning|WARNING) at /.test(message.text)) texts.push({ time: message.time, text: message.text, key: null });
      continue;
    }
    // The tracer's timings, reported as a warning with each overrun.
    if (!message.text || /Tracer|printEpochs/.test(message.location)) continue;
    // The first sentence says what; the rest is advice. A CTRE device's
    // report says which device, first, so each device's are their own.
    const what = message.text.split(/\r?\n/)[0].split(/(?<=\.)\s+(?=[A-Z])/)[0];
    const device = message.from === 'robot' ? deviceOf(message.location) : '';
    texts.push({ time: message.time, text: `${message.severity === 'error' ? 'Error' : 'Warning'}: ${device ? `${device}: ` : ''}${what}`, key: null, from: device });
  }
  // The Driver Station writes these down every 2 s or so: an error that
  // keeps happening is seen a little over 2 s apart.
  return [...out, ...consoleTextEvents(texts, dsMessageGapSeconds)];
}

const dsMessageGapSeconds = 5;

// `talon fx 10 ("Canivore") Status Signal Position` -> "talon fx 10 (Canivore)".
// Other locations are where in the code, which the message says enough without.
export function deviceOf(location: string): string {
  const device = /^([A-Za-z][A-Za-z ]*?\s\d+(?:\s\d+)?)\s*\("([^"]*)"\)/.exec(location);
  return device ? `${device[1]} (${device[2] || 'rio'})` : '';
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

// When the robot was enabled (auto, teleop or test), as spans. A brief drop
// (a dropped packet) doesn't split one.
export function enabledSpans(changes: ModeChange[], end: number): [number, number][] {
  const spans: [number, number][] = [];
  changes.forEach((change, i) => {
    if (change.mode === 'disabled') return;
    const until = changes[i + 1]?.time ?? end;
    const last = spans[spans.length - 1];
    if (last && change.time - last[1] <= 2) last[1] = Math.max(last[1], until);
    else spans.push([change.time, until]);
  });
  return spans.filter(([start, stop]) => stop > start);
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
