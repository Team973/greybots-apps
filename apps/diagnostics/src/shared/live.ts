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

export const isLiveId = (id: string) => id.startsWith('live:');

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
  received: number;
}
