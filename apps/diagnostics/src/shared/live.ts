// Live signals: the robot's (or a simulator's) NetworkTables, read as they
// change. The Signals page lists these as sessions beside the logs.

import type { ShortcutAction } from './shortcuts';

export interface LiveSession {
  id: string;
  label: string;
  // The keyboard shortcut that opens it from anywhere in the app (App.vue).
  shortcut: ShortcutAction;
}

export const liveSessions: LiveSession[] = [
  { id: 'live:robot', label: 'Live: the robot', shortcut: 'liveRobot' },
  { id: 'live:sim', label: 'Live: a simulator on this computer', shortcut: 'liveSim' }
];

// How much a live session keeps: older values go, except the one still holding.
export const liveKeepSeconds = 10 * 60;

// Live sessions, and earlier runs kept from them (live:robot#2).
export const isLiveId = (id: string) => id.startsWith('live:');

// A session that's live now (and moves along), not an earlier run.
export const isLiveNow = (id: string) => liveSessions.some((live) => live.id === id);

// A run recorded live and kept, when the robot code restarted or the window
// looked away, to plot from after the fact until the app closes. Its id is
// a session id for reading signals.
export interface EarlierRun {
  id: string;
  // The live session it came from.
  target: string;
  host: string;
  startedAt: string;
  endedAt: string;
  signals: number;
}

export type LiveState = 'connecting' | 'connected' | 'disconnected';

export interface LiveStatus {
  id: string;
  state: LiveState;
  // Where it's connected, or was last.
  host: string;
  // Why it isn't connected, or ''.
  message: string;
  // The span of what's kept, in seconds since connecting.
  start: number;
  end: number;
  // How many signals, and values so far: when either changes, there's more to show.
  signals: number;
  // Whether the signal list is the last run's, as it was: not connected, or
  // a new run that hasn't said what it has yet.
  stale: boolean;
  received: number;
  // How many earlier runs are kept: when it changes, the list of them has.
  earlierRuns: number;
}
