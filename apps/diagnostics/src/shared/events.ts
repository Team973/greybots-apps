// What happened in a log, for review (#94): events found in its signals
// (brownouts, CAN errors, device faults, loop overruns, ...), the match's
// phases, and notes people add. Both sides share these.
//
// Nothing here may touch Node or the DOM.

import type { MonitorResult } from './monitors';

export type EventSeverity = 'error' | 'warning' | 'info';

export type EventKind =
  | 'mode'
  | 'brownout'
  | 'can'
  | 'fault'
  | 'overrun'
  | 'network'
  | 'alert'
  | 'message'
  | 'state'
  | 'command'
  | 'monitor'
  | 'note';

export const eventKinds: { kind: EventKind; label: string }[] = [
  { kind: 'mode', label: 'Enable and mode' },
  { kind: 'brownout', label: 'Brownouts' },
  { kind: 'can', label: 'CAN' },
  { kind: 'fault', label: 'Device faults' },
  { kind: 'overrun', label: 'Loop overruns' },
  { kind: 'network', label: 'Network' },
  { kind: 'alert', label: 'Alerts' },
  { kind: 'message', label: 'Console' },
  { kind: 'state', label: 'Subsystem states' },
  { kind: 'command', label: 'Driver input' },
  { kind: 'monitor', label: 'Monitors' },
  { kind: 'note', label: 'Notes' }
];

// Kinds that are many and ordinary (every state change, every button
// press): listed only when picked.
export const quietKinds: EventKind[] = ['state', 'command'];

export interface LogEvent {
  // The same each time the log is read: kind, what, and when.
  id: string;
  kind: EventKind;
  severity: EventSeverity;
  // Seconds, on the session's timeline (as signal series). A span when it
  // lasted (a brownout, a fault held); `end` is null for a moment.
  start: number;
  end: number | null;
  // Short: "Brownout", "TalonFX-59: supply current limit".
  title: string;
  // More, when there is: the message, how many times, the largest count.
  detail: string;
  // How many times it happened: ones close together are one event.
  count: number;
  // The signal to plot to see it, if there's one.
  key: string | null;
}

export type MatchPhaseName = 'auto' | 'teleop' | 'endgame';

export const phaseLabels: Record<MatchPhaseName, string> = { auto: 'Auto', teleop: 'Teleop', endgame: 'Endgame' };

export interface MatchPhase {
  name: MatchPhaseName;
  start: number;
  end: number;
}

// A note someone added at a time in a log.
export interface Annotation {
  id: string;
  time: number;
  text: string;
  // ISO times.
  created: string;
  changed: string;
}

export interface SessionEvents {
  events: LogEvent[];
  phases: MatchPhase[];
  // When the robot was enabled (any mode), in seconds on the timeline.
  enabled: [number, number][];
  // The post-match monitors' results (their alarms are events too).
  monitors: MonitorResult[];
  notes: Annotation[];
  // What's still being looked through (device faults in Hoot logs, which
  // owlet exports first), or ''. Asked for again until it's ''.
  pending: string;
}

// The last part of a match's teleop that's its endgame, in seconds. Each
// season's game says; 2026's (REBUILT) is the last 30 seconds.
export const endgameSeconds = 30;

export const maxNoteLength = 2000;

// Spans of one kind of event closer than this are one event: a fault that
// flickers, overruns loop after loop.
export const mergeGapSeconds = 2;

// Joins spans less than `gap` apart, counting how many each became.
export function mergeSpans(spans: { start: number; end: number | null }[], gap = mergeGapSeconds) {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const out: { start: number; end: number | null; count: number }[] = [];
  for (const span of sorted) {
    const last = out[out.length - 1];
    const lastEnd = last ? last.end ?? last.start : -Infinity;
    if (last && span.start - lastEnd <= gap) {
      const end = Math.max(lastEnd, span.end ?? span.start);
      last.end = end > last.start ? end : last.end;
      last.count += 1;
    } else {
      out.push({ start: span.start, end: span.end, count: 1 });
    }
  }
  return out;
}

// "Teleop 1:05": the phase a time is in and how far into it, or ''.
export function phaseClock(phases: MatchPhase[], t: number): string {
  const at = phaseAt(phases, t);
  if (!at) return '';
  const seconds = Math.max(0, at.into);
  return `${phaseLabels[at.phase.name]} ${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

// Power problems: brownouts, and faults, alerts and messages about the
// battery, voltage, supply current, breakers or reboots. What a Power
// Analysis report lists, rather than wheel slip or a camera.
const powerWords = /brown ?out|under ?volt|voltage|supply|battery|breaker|power|reboot/i;
export const isPowerEvent = (event: LogEvent) =>
  event.kind === 'brownout' || (['fault', 'alert', 'message', 'can'].includes(event.kind) && powerWords.test(event.title));

// The Pigeon's faults, and the CANivore's problems (its bus down, errors,
// buffer full): what a Match Report's Pigeon and CANivore section lists.
export const isPigeonCanivoreEvent = (event: LogEvent) =>
  (event.kind === 'fault' && /^Pigeon2-/.test(event.title)) || (event.kind === 'can' && /canivore/i.test(event.title));

// The playback tape's stretches: the log cut into disabled, auto, teleop
// and endgame (and enabled, outside a match's phases: test mode, or a log
// with no modes), each as long as it lasted, in order, from start to end.
export type TapeKind = 'disabled' | 'enabled' | MatchPhaseName;
export const tapeLabels: Record<TapeKind, string> = { disabled: 'Disabled', enabled: 'Enabled', ...phaseLabels };
export interface TapeSegment {
  kind: TapeKind;
  start: number;
  end: number;
}

export function tapeSegments(full: [number, number], phases: MatchPhase[], enabled: [number, number][]): TapeSegment[] {
  const [from, to] = full;
  if (!(to > from)) return [];
  const edges = [from, to, ...phases.flatMap((p) => [p.start, p.end]), ...enabled.flat()]
    .filter((t) => t > from && t < to);
  const cuts = [...new Set([from, ...edges, to])].sort((a, b) => a - b);
  const out: TapeSegment[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [start, end] = [cuts[i], cuts[i + 1]];
    const mid = (start + end) / 2;
    const phase = phaseAt(phases, mid)?.phase.name;
    const kind: TapeKind = phase ?? (enabled.some(([a, b]) => mid >= a && mid <= b) ? 'enabled' : 'disabled');
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.end = end;
    else out.push({ kind, start, end });
  }
  return out;
}

// The phase a time is in, and how far into it.
export function phaseAt(phases: MatchPhase[], t: number): { phase: MatchPhase; into: number } | null {
  // Endgame is inside teleop: it wins.
  const phase = phases.find((p) => p.name === 'endgame' && t >= p.start && t <= p.end) ??
    phases.find((p) => t >= p.start && t <= p.end);
  return phase ? { phase, into: t - phase.start } : null;
}
