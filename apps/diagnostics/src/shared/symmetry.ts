// How alike two signals that should match are: a mechanism's left and right
// motors (their currents, an arm's two positions). Over a report's spans,
// each held until its next value as the line chart draws them: each one's
// mean, and how far apart they were on average and at most. Only while the
// pair is running, if the section says (either above `activeAbove`), so a
// roller pair sitting at 0 A doesn't count as alike.
//
// Nothing here may touch Node or the DOM.

export interface SymmetryPairSpec {
  label: string;
  a: string;
  b: string;
  // Only where either is above this (by size), or always (null).
  activeAbove: number | null;
  // Compared by size: motors mounted facing each other run opposite ways,
  // so their currents have opposite signs.
  magnitude: boolean;
  // Only while a text signal (a mechanism's state) is this value: a
  // flywheel's target is worked out even while it's off, so it's only
  // held to it while it's in closed loop. Left out, or null: always.
  onlyWhile?: { key: string; value: string } | null;
}

export interface SymmetryRow {
  label: string;
  // The signals found (null when the log hasn't it), and how they're named.
  a: string | null;
  b: string | null;
  aLabel: string;
  bLabel: string;
  unit: string;
  // When they're compared, if only sometimes: "while shooter / state is
  // ClosedLoop" ('' for always). And a signal the log hasn't, if any.
  condition?: string;
  missing?: string;
  // How long they were compared (running, within the spans).
  seconds: number;
  meanA: number | null;
  meanB: number | null;
  // A − B on average (which is higher), its size on average, and its
  // largest size, with when.
  meanGap: number | null;
  meanAbsGap: number | null;
  maxAbsGap: number | null;
  maxAt: number | null;
}

export interface SymmetrySeries {
  times: ArrayLike<number>;
  values: ArrayLike<number>;
}

export interface SymmetryResult {
  seconds: number;
  meanA: number | null;
  meanB: number | null;
  meanGap: number | null;
  meanAbsGap: number | null;
  maxAbsGap: number | null;
  maxAt: number | null;
}

// Where a text signal is `value`, within the spans: each value holds until
// the next, and the last to the end of the spans.
export function spansWhereText(series: { times: ArrayLike<number>; values: ArrayLike<string> }, value: string, spans: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [start, end] of spans) {
    let from: number | null = null;
    let i = lastAt(series.times, start);
    if (i >= 0 && series.values[i] === value) from = start;
    for (i += 1; i < series.times.length && series.times[i] < end; i++) {
      const t = series.times[i];
      const holds = series.values[i] === value;
      if (holds && from === null) from = t;
      if (!holds && from !== null) {
        if (t > from) out.push([from, t]);
        from = null;
      }
    }
    if (from !== null && end > from) out.push([from, end]);
  }
  return out;
}

// The index of the last sample at or before t, or -1.
function lastAt(times: ArrayLike<number>, t: number): number {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (times[mid] <= t) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}

export function compareSymmetry(
  a: SymmetrySeries,
  b: SymmetrySeries,
  spans: [number, number][],
  options: { activeAbove: number | null; magnitude: boolean }
): SymmetryResult {
  let seconds = 0;
  let sumA = 0;
  let sumB = 0;
  let sumGap = 0;
  let sumAbsGap = 0;
  let maxAbsGap = -1;
  let maxAt: number | null = null;
  const value = (v: number) => (options.magnitude ? Math.abs(v) : v);

  for (const [start, end] of spans) {
    if (!(end > start)) continue;
    // Every moment either changes within the span, in order.
    const moments: number[] = [start];
    for (const series of [a, b]) {
      for (let i = Math.max(0, lastAt(series.times, start) + 1); i < series.times.length && series.times[i] < end; i++) moments.push(series.times[i]);
    }
    moments.sort((x, y) => x - y);
    moments.push(end);
    let ia = lastAt(a.times, start);
    let ib = lastAt(b.times, start);
    for (let k = 0; k < moments.length - 1; k++) {
      const from = moments[k];
      const to = moments[k + 1];
      if (to <= from) continue;
      while (ia + 1 < a.times.length && a.times[ia + 1] <= from) ia++;
      while (ib + 1 < b.times.length && b.times[ib + 1] <= from) ib++;
      // Before either's first value, there's nothing to compare.
      if (ia < 0 || ib < 0) continue;
      const va = value(a.values[ia]);
      const vb = value(b.values[ib]);
      if (!Number.isFinite(va) || !Number.isFinite(vb)) continue;
      if (options.activeAbove !== null && Math.max(Math.abs(va), Math.abs(vb)) < options.activeAbove) continue;
      const dt = to - from;
      const gap = va - vb;
      seconds += dt;
      sumA += va * dt;
      sumB += vb * dt;
      sumGap += gap * dt;
      sumAbsGap += Math.abs(gap) * dt;
      if (Math.abs(gap) > maxAbsGap) {
        maxAbsGap = Math.abs(gap);
        maxAt = from;
      }
    }
  }
  if (seconds === 0) return { seconds: 0, meanA: null, meanB: null, meanGap: null, meanAbsGap: null, maxAbsGap: null, maxAt: null };
  return {
    seconds,
    meanA: sumA / seconds,
    meanB: sumB / seconds,
    meanGap: sumGap / seconds,
    meanAbsGap: sumAbsGap / seconds,
    maxAbsGap,
    maxAt
  };
}
