// Signals already decoded into memory (a Driver Station log's), offering
// what a data log's source does: a catalog, and a signal's values over a
// span, downsampled, with its stats.

import type { SignalInfo, SignalRange, SignalSeries } from '@shared/signals';
import { downsample, firstAtOrAfter, heldStats } from './log-source';

interface Stored {
  info: SignalInfo;
  times: number[];
  values: number[] | string[];
}

export class MemorySignalSource {
  private signals = new Map<string, Stored>();

  // Seconds: series times are counted from the source's start.
  constructor(readonly lastTime: number) {}

  // Values in time order. Numbers and booleans (1/0) only where they
  // change are enough: a value holds until the next.
  add(info: SignalInfo, times: number[], values: number[] | string[]) {
    this.signals.set(info.key, { info: { ...info, count: times.length }, times, values });
  }

  catalog(): SignalInfo[] {
    return [...this.signals.values()].map((s) => s.info);
  }

  read(key: string, range: SignalRange = {}): SignalSeries | null {
    const stored = this.signals.get(key);
    if (!stored) return null;
    const { times, values, info } = stored;
    const start = range.start ?? -Infinity;
    const end = range.end ?? Infinity;
    // As in a data log: the value just outside each end too, so the line
    // reaches the edges.
    const timeAt = (i: number) => times[i];
    const first = Math.max(0, firstAtOrAfter(times.length, timeAt, start) - (range.start === undefined ? 0 : 1));
    const last = Math.min(times.length, firstAtOrAfter(times.length, timeAt, end, true) + (range.end === undefined ? 0 : 1));
    const shownTimes = times.slice(first, last);

    if (info.kind === 'string') {
      return { key, kind: 'string', times: Float64Array.from(shownTimes), values: (values as string[]).slice(first, last), downsampled: false, stats: null };
    }
    const numbers = (values as number[]).slice(first, last);
    const stats = heldStats(shownTimes, numbers, start, end, this.lastTime);
    const maxPoints = range.maxPoints ?? Infinity;
    if (numbers.length <= maxPoints) {
      return { key, kind: info.kind, times: Float64Array.from(shownTimes), values: Float64Array.from(numbers), downsampled: false, stats };
    }
    const reduced = downsample(shownTimes, numbers, maxPoints);
    return { key, kind: info.kind, times: reduced.times, values: reduced.values, downsampled: true, stats };
  }
}
