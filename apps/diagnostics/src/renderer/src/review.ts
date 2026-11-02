// What the Signals page shows of a log's events (shared/events.ts): their
// colours, which are routine, and notes as events, so they're marked,
// listed and jumped to like the rest.

import { phaseClock, type Annotation, type EventKind, type LogEvent, type MatchPhase } from '@shared/events';

// Status colours, kept for events and used for nothing else: red for
// errors, amber for warnings. Every event is named beside its mark, so
// colour is never all that tells them apart.
const colors = {
  light: { error: '#d03b3a', warning: '#c98500', info: '#8a8f98', note: '#6250d6' },
  dark: { error: '#e66767', warning: '#e0a526', info: '#9aa0a8', note: '#9085e9' }
};

export function eventColor(event: LogEvent, dark: boolean): string {
  const set = dark ? colors.dark : colors.light;
  return event.kind === 'note' ? set.note : set[event.severity];
}

// Information that's the robot doing as it should (a current limit holding,
// a dashboard closing): hidden unless asked for. Enables, notes, states and
// driver input show whenever their kind's picked.
const neverRoutine: EventKind[] = ['mode', 'note', 'state', 'command'];
export function isRoutine(event: LogEvent): boolean {
  return event.severity === 'info' && !neverRoutine.includes(event.kind);
}

export const isProblem = (event: LogEvent) => event.severity === 'error' || event.severity === 'warning';

export function noteEvent(note: Annotation): LogEvent {
  const [first, ...rest] = note.text.split('\n');
  return {
    id: `note:${note.id}`,
    kind: 'note',
    severity: 'info',
    start: note.time,
    end: null,
    title: first,
    detail: rest.join('\n').trim(),
    count: 1,
    key: null
  };
}

export interface EventFilter {
  kinds: EventKind[];
  routine: boolean;
}

export function shownEvent(event: LogEvent, filter: EventFilter): boolean {
  return filter.kinds.includes(event.kind) && (filter.routine || !isRoutine(event));
}

// "123.4 s · Teleop 0:42".
export function eventTime(t: number, phases: MatchPhase[]): string {
  const clock = phaseClock(phases, t);
  return clock ? `${t.toFixed(1)} s · ${clock}` : `${t.toFixed(1)} s`;
}
