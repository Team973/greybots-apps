// Field heatmaps: the field cut into squares, and for each, how much of
// something happened while the robot was in it. Where it spent its time; a
// signal's average while there (a motor's current, a camera's latency); or
// how much a counter went up while there (a camera's frames used).
//
// Nothing here may touch Node or the DOM.

export type HeatMeasure = 'time' | 'mean' | 'increase';

export const heatMeasureLabels: Record<HeatMeasure, string> = {
  time: 'Time spent there',
  mean: "The signal's average there",
  increase: 'How much it went up there (a counter)'
};

export interface HeatCell {
  // Which square: x metres / cell, y metres / cell, rounded down.
  col: number;
  row: number;
  value: number;
}

export interface FieldHeat {
  // The squares' size, metres.
  cell: number;
  measure: HeatMeasure;
  cells: HeatCell[];
}

interface Track {
  times: ArrayLike<number>;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
}
interface Values {
  times: ArrayLike<number>;
  values: ArrayLike<number>;
}

export const defaultHeatCell = 0.5;
// A pose older than this (seconds) isn't where the robot was, by default.
const defaultFresh = 1;

// The latest at or before t (an index), or -1.
function latest(times: ArrayLike<number>, t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

// Within any of the spans (none given: everywhere).
const inSpans = (spans: [number, number][] | undefined, t: number) => !spans || spans.some(([a, b]) => t >= a && t <= b);

export function fieldHeat(pose: Track, signal: Values | null, measure: HeatMeasure, cell = defaultHeatCell, spans?: [number, number][], poseFresh = defaultFresh): FieldHeat {
  const sums = new Map<string, { col: number; row: number; sum: number; count: number }>();
  const add = (x: number, y: number, value: number) => {
    // (0, 0) is no pose.
    if (!Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0)) return;
    const col = Math.floor(x / cell);
    const row = Math.floor(y / cell);
    const key = `${col},${row}`;
    const at = sums.get(key) ?? { col, row, sum: 0, count: 0 };
    at.sum += value;
    at.count += 1;
    sums.set(key, at);
  };
  // Where the robot was at t, if it's known then.
  const where = (t: number) => {
    const i = latest(pose.times, t);
    return i >= 0 && t - pose.times[i] <= poseFresh ? i : -1;
  };

  if (measure === 'time' || !signal) {
    for (let i = 0; i < pose.times.length; i++) {
      const t = pose.times[i];
      if (!inSpans(spans, t)) continue;
      const next = i + 1 < pose.times.length ? pose.times[i + 1] : t;
      add(Number(pose.x[i]), Number(pose.y[i]), Math.min(poseFresh, next - t));
    }
  } else {
    for (let i = 0; i < signal.times.length; i++) {
      const t = signal.times[i];
      if (!inSpans(spans, t)) continue;
      const p = where(t);
      if (p < 0) continue;
      const value = Number(signal.values[i]);
      if (!Number.isFinite(value)) continue;
      if (measure === 'mean') add(Number(pose.x[p]), Number(pose.y[p]), value);
      else if (i > 0) {
        // A counter: what it went up by since its last value (from 0 again
        // if it went down: the robot code restarted).
        const before = Number(signal.values[i - 1]);
        const rise = value >= before ? value - before : value;
        if (rise > 0) add(Number(pose.x[p]), Number(pose.y[p]), rise);
      }
    }
  }
  const cells = [...sums.values()].map(({ col, row, sum, count }) => ({ col, row, value: measure === 'mean' ? sum / count : sum }))
    .filter((c) => measure === 'mean' || c.value > 0);
  return { cell, measure, cells };
}

// Each square's share (0 to 1) of the strongest: from 0 for time and
// counters, from the weakest for averages. `top`: share another's scale
// (several heatmaps compared on one field).
export function heatShares(heat: FieldHeat, top?: number): { col: number; row: number; share: number }[] {
  const values = heat.cells.map((c) => c.value);
  if (values.length === 0) return [];
  const hi = top ?? Math.max(...values);
  const lo = heat.measure === 'mean' ? Math.min(...values) : 0;
  const range = hi - lo;
  return heat.cells.map((c) => ({ col: c.col, row: c.row, share: range > 0 ? Math.min(1, Math.max(0, (c.value - lo) / range)) : 1 }));
}

// The strongest square's value (for a legend), or null with none.
export const heatPeak = (heat: FieldHeat): number | null => (heat.cells.length ? Math.max(...heat.cells.map((c) => c.value)) : null);
