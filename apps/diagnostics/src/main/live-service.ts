// The live session: one NetworkTables connection at a time, to the robot or
// to a simulator on this computer, kept up while the window is looking at
// it. It reconnects on its own, and keeps what it had through a dropout
// (unless the robot's clock started again: robot code restarted).

import type { SignalLogSummary } from '@shared/ipc';
import { isLiveId, type LiveState, type LiveStatus } from '@shared/live';
import { robotAddresses, type RobotAddress } from '@shared/robot-address';
import type { Settings } from '@shared/settings';
import { groupSignals, type SignalRange, type SignalSeries } from '@shared/signals';
import { checkPort } from './connection-check';
import { LiveSignalSource } from './live/live-source';
import { Nt4Client, nt4Port } from './live/nt4-client';
import { loadSettings } from './settings-store';

const retryMs = 1500;
// The window asks for the status several times a second while it's showing
// a live session. When it stops (another page, another session, closed),
// the connection goes.
const idleMs = 15000;

interface Live {
  id: string;
  state: LiveState;
  host: string;
  message: string;
  client: Nt4Client | null;
  source: LiveSignalSource | null;
  // When the source's timeline started, by the clock.
  startedAt: Date | null;
  lastAsked: number;
  retry: ReturnType<typeof setTimeout> | undefined;
  stopped: boolean;
}

let live: Live | null = null;

function addressesFor(id: string, settings: Settings): RobotAddress[] {
  if (id === 'live:sim') return [{ label: 'This computer', host: '127.0.0.1' }];
  return robotAddresses(settings);
}

function stop(session: Live) {
  session.stopped = true;
  clearTimeout(session.retry);
  session.client?.close();
}

function session(id: string): Live {
  if (!isLiveId(id) || (id !== 'live:robot' && id !== 'live:sim')) throw new Error('No such live session.');
  if (live?.id === id) {
    live.lastAsked = Date.now();
    return live;
  }
  if (live) stop(live);
  live = {
    id,
    state: 'connecting',
    host: '',
    message: '',
    client: null,
    source: null,
    startedAt: null,
    lastAsked: Date.now(),
    retry: undefined,
    stopped: false
  };
  void connect(live);
  return live;
}

setInterval(() => {
  if (live && Date.now() - live.lastAsked > idleMs) {
    stop(live);
    live = null;
  }
}, 5000).unref();

async function connect(session: Live) {
  if (session.stopped) return;
  // Trying again after a dropout stays 'disconnected' until it's back.
  if (session.state !== 'disconnected') session.state = 'connecting';
  const addresses = addressesFor(session.id, await loadSettings());

  // Every address at once; the first in order that has NetworkTables.
  const checks = await Promise.all(addresses.map((address) => checkPort(address.host, nt4Port, 'NetworkTables (NT4)')));
  if (session.stopped) return;
  const found = addresses.find((_, i) => checks[i].open);
  if (!found) {
    session.state = 'disconnected';
    session.message = session.id === 'live:sim'
      ? 'No simulator found on this computer (nothing on port 5810). Start the robot simulation, and this connects on its own.'
      : `No robot found at ${addresses.map((a) => a.host).join(', ')}. This keeps trying.`;
    session.retry = setTimeout(() => connect(session), retryMs);
    return;
  }

  session.host = found.host;
  session.client = new Nt4Client(found.host, {
    connected(serverUs) {
      if (!session.source || !session.source.continues(serverUs)) {
        session.source = new LiveSignalSource(serverUs);
        session.startedAt = new Date();
      }
      session.state = 'connected';
      session.message = '';
    },
    announce(topic) {
      session.source?.announce(topic);
    },
    unannounce() {
      // What it had stays: it's still worth looking at.
    },
    value(topic, timeUs, value) {
      session.source?.add(topic, timeUs, value);
    },
    closed(reason) {
      session.client = null;
      if (session.stopped) return;
      session.state = 'disconnected';
      session.message = `${reason} Reconnecting…`;
      session.retry = setTimeout(() => connect(session), retryMs);
    }
  });
}

// Moves the timeline to the robot's clock now, while connected.
function tick(session: Live) {
  const serverUs = session.client?.serverTime();
  if (session.state === 'connected' && session.source && serverUs != null) {
    session.source.now = Math.max(session.source.now, (serverUs - session.source.originUs) / 1e6);
  }
}

export function liveStatus(id: string): LiveStatus {
  const s = session(id);
  tick(s);
  const source = s.source;
  return {
    id,
    state: s.state,
    host: s.host,
    message: s.message,
    start: source?.start ?? 0,
    end: source?.now ?? 0,
    signals: source?.catalog().length ?? 0,
    received: source?.received ?? 0
  };
}

export function openLive(id: string): SignalLogSummary {
  const s = session(id);
  tick(s);
  const signals = s.source?.catalog() ?? [];
  return {
    id,
    duration: s.source ? s.source.now - s.source.start : 0,
    startedAt: s.startedAt?.toISOString() ?? null,
    truncated: false,
    signals,
    groups: groupSignals(signals),
    warnings: []
  };
}

export function readLive(id: string, key: string, range: SignalRange): SignalSeries | null {
  const s = session(id);
  tick(s);
  return s.source?.read(key, range) ?? null;
}
