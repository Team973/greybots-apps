// The live session: one NetworkTables connection at a time, to the robot or
// to a simulator on this computer, kept up while the window is looking at
// it. It reconnects on its own, and keeps what it had through a dropout.
//
// What was recorded isn't thrown away: when the robot's clock starts again
// (robot code restarted) or the window stops looking, the run so far is
// kept as an earlier run, to plot anything from after the fact (before the
// logs are pulled), until the app closes. Coming back to a robot whose clock
// carries on picks its run up again.

import type { SignalLogSummary } from '@shared/ipc';
import { liveSessions, type EarlierRun, type LiveState, type LiveStatus } from '@shared/live';
import { robotAddresses, type RobotAddress } from '@shared/robot-address';
import type { Settings } from '@shared/settings';
import { groupSignals, type SignalInfo, type SignalRange, type SignalSeries } from '@shared/signals';
import { checkPort } from './connection-check';
import { LiveSignalSource } from './live/live-source';
import { Nt4Client, nt4Port } from './live/nt4-client';
import { loadSettings } from './settings-store';

const retryMs = 1500;
// The window asks for the status several times a second while it's showing
// a live session. When it stops (another page, another session, closed),
// the connection goes.
const idleMs = 15000;
// A new run's signal list is shown once the robot's had this long to say
// what it has; until then, the last run's list stands (stale).
const settleMs = 1500;
// Earlier runs kept, newest first. Each is up to 10 minutes of everything.
const maxEarlierRuns = 3;

interface Run {
  source: LiveSignalSource;
  host: string;
  // By the clock.
  startedAt: Date;
  endedAt: Date | null;
}

interface Live {
  id: string;
  state: LiveState;
  host: string;
  message: string;
  client: Nt4Client | null;
  run: Run | null;
  // The run before this one (or an earlier run of the same robot), whose
  // signal list is shown until this one's settles.
  stale: Run | null;
  connectedAt: number;
  lastAsked: number;
  retry: ReturnType<typeof setTimeout> | undefined;
  stopped: boolean;
}

let live: Live | null = null;
const earlier: (Run & { id: string; target: string })[] = [];
let runCount = 0;

function addressesFor(id: string, settings: Settings): RobotAddress[] {
  if (id === 'live:sim') return [{ label: 'This computer', host: '127.0.0.1' }];
  return robotAddresses(settings);
}

// Keeps a run that recorded something, to look at later.
function keep(target: string, run: Run | null) {
  if (!run || run.source.received === 0 || earlier.some((e) => e.source === run.source)) return;
  earlier.unshift({ ...run, endedAt: run.endedAt ?? new Date(), id: `${target}#${++runCount}`, target });
  earlier.splice(maxEarlierRuns);
}

function stop(session: Live) {
  session.stopped = true;
  clearTimeout(session.retry);
  session.client?.close();
  keep(session.id, session.run);
}

function session(id: string): Live {
  if (!liveSessions.some((l) => l.id === id)) throw new Error('No such live session.');
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
    run: null,
    // Until it connects, the last run from here shows what it had.
    stale: earlier.find((e) => e.target === id) ?? null,
    connectedAt: 0,
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
      if (!session.run || !session.run.source.continues(serverUs)) {
        // The run before carries on if the robot's clock does (it was looked
        // away from, or the connection dropped); otherwise it's kept, and a
        // new one starts.
        const resumed = earlier.findIndex((e) => e.target === session.id && e.source.continues(serverUs) && e.source.originUs <= serverUs);
        if (session.run) {
          session.run.endedAt = new Date();
          keep(session.id, session.run);
          session.stale = session.run;
        }
        if (resumed !== -1 && !session.run) {
          const [run] = earlier.splice(resumed, 1);
          session.run = { source: run.source, host: run.host, startedAt: run.startedAt, endedAt: null };
        } else {
          session.run = { source: new LiveSignalSource(serverUs), host: found.host, startedAt: new Date(), endedAt: null };
        }
      }
      session.connectedAt = Date.now();
      session.state = 'connected';
      session.message = '';
    },
    announce(topic) {
      session.run?.source.announce(topic);
    },
    unannounce() {
      // What it had stays: it's still worth looking at.
    },
    value(topic, timeUs, value) {
      session.run?.source.add(topic, timeUs, value);
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
  const source = session.run?.source;
  if (session.state === 'connected' && source && serverUs != null) {
    source.now = Math.max(source.now, (serverUs - source.originUs) / 1e6);
  }
}

// The signal list to show: this run's, once it's had time to say what it
// has, otherwise the run before's, as it was.
function shownSignals(session: Live): { signals: SignalInfo[]; stale: boolean } {
  const current = session.run?.source.catalog() ?? [];
  const settled = session.state === 'connected' && current.length > 0 && Date.now() - session.connectedAt >= settleMs;
  if (settled || !session.stale) return { signals: current, stale: session.state !== 'connected' };
  // While a new run settles, signals it's already announced join the list.
  const known = new Set(current.map((s) => s.key));
  return { signals: [...current, ...session.stale.source.catalog().filter((s) => !known.has(s.key))], stale: true };
}

const earlierRun = (id: string) => earlier.find((e) => e.id === id);

export function earlierRuns(): EarlierRun[] {
  return earlier.map((run) => ({
    id: run.id,
    target: run.target,
    host: run.host,
    startedAt: run.startedAt.toISOString(),
    endedAt: (run.endedAt ?? new Date()).toISOString(),
    signals: run.source.catalog().length
  }));
}

export function liveStatus(id: string): LiveStatus {
  const s = session(id);
  tick(s);
  const source = s.run?.source;
  const shown = shownSignals(s);
  return {
    id,
    state: s.state,
    host: s.host,
    message: s.message,
    start: source?.start ?? 0,
    end: source?.now ?? 0,
    signals: shown.signals.length,
    stale: shown.stale,
    received: source?.received ?? 0,
    earlierRuns: earlier.length
  };
}

export function openLive(id: string): SignalLogSummary {
  const kept = earlierRun(id);
  if (kept) {
    const signals = kept.source.catalog();
    return {
      id,
      duration: kept.source.now - kept.source.start,
      start: kept.source.start,
      startedAt: kept.startedAt.toISOString(),
      truncated: false,
      signals,
      groups: groupSignals(signals),
      warnings: []
    };
  }
  const s = session(id);
  tick(s);
  const { signals } = shownSignals(s);
  const source = s.run?.source;
  return {
    id,
    duration: source ? source.now - source.start : 0,
    startedAt: s.run?.startedAt.toISOString() ?? null,
    truncated: false,
    signals,
    groups: groupSignals(signals),
    warnings: []
  };
}

export function readLive(id: string, key: string, range: SignalRange): SignalSeries | null {
  const kept = earlierRun(id);
  if (kept) return kept.source.read(key, range);
  const s = session(id);
  tick(s);
  return s.run?.source.read(key, range) ?? null;
}
