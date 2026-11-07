// Field heatmaps as point clouds: a point on the field for each sample,
// where the robot was then, weighted by how much it counts. Drawn, points
// close together pile up into hotspots (see heatDensity): where it spent
// its time, a signal's average while there (a motor's current, a camera's
// latency), or how much a counter went up while there (a camera's frames
// used).
//
// Nothing here may touch Node or the DOM.

export type HeatMeasure = 'time' | 'mean' | 'increase';

export const heatMeasureLabels: Record<HeatMeasure, string> = {
  time: 'Time spent there',
  mean: "The signal's average there",
  increase: 'How much it went up there (a counter)'
};

export interface HeatPoint {
  x: number;
  y: number;
  // How much it counts: seconds (time), the counter's rise (increase), or 1 (mean).
  w: number;
  // The signal's value (mean only).
  v?: number;
}

export interface FieldHeat {
  measure: HeatMeasure;
  points: HeatPoint[];
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

// A pose older than this (seconds) isn't where the robot was, by default.
const defaultFresh = 1;
// To the centimetre: kept in reports.
const cm = (value: number) => Math.round(value * 100) / 100;

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

export function fieldHeat(pose: Track, signal: Values | null, measure: HeatMeasure, spans?: [number, number][], poseFresh = defaultFresh): FieldHeat {
  const points: HeatPoint[] = [];
  const add = (x: number, y: number, w: number, v?: number) => {
    // (0, 0) is no pose.
    if (!Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0) || !(w > 0)) return;
    points.push(v === undefined ? { x: cm(x), y: cm(y), w } : { x: cm(x), y: cm(y), w, v });
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
      if (measure === 'mean') add(Number(pose.x[p]), Number(pose.y[p]), 1, value);
      else if (i > 0) {
        // A counter: what it went up by since its last value (from 0 again
        // if it went down: the robot code restarted).
        const before = Number(signal.values[i - 1]);
        add(Number(pose.x[p]), Number(pose.y[p]), value >= before ? value - before : value);
      }
    }
  }
  return { measure, points };
}

// --- Drawing: points into fine bins, blurred a little ---

export interface HeatBin {
  // Which bin: x / size, y / size, rounded down.
  col: number;
  row: number;
  // The weight piled up there (each point spread over its neighbours).
  weight: number;
  // For averages: the weighted average of the values there.
  value?: number;
}

// Each point spread over the bins around it (a small Gaussian, `radius`
// bins out), so points near each other pile up into a hotspot rather than
// sitting in squares.
export function heatDensity(heat: FieldHeat, size: number, radius = 2): HeatBin[] {
  const bins = new Map<number, { col: number; row: number; weight: number; sum: number }>();
  const kernel: [number, number, number][] = [];
  const sigma = Math.max(0.5, radius / 2);
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const d2 = dx * dx + dy * dy;
      if (d2 <= radius * radius) kernel.push([dx, dy, Math.exp(-d2 / (2 * sigma * sigma))]);
    }
  }
  for (const p of heat.points) {
    const col = Math.floor(p.x / size);
    const row = Math.floor(p.y / size);
    for (const [dx, dy, k] of kernel) {
      const c = col + dx;
      const r = row + dy;
      // Packed: a field is far fewer than 100000 bins across.
      const key = c * 100000 + r;
      const at = bins.get(key) ?? { col: c, row: r, weight: 0, sum: 0 };
      at.weight += p.w * k;
      at.sum += (p.v ?? 0) * p.w * k;
      bins.set(key, at);
    }
  }
  return [...bins.values()].map(({ col, row, weight, sum }) =>
    (heat.measure === 'mean' ? { col, row, weight, value: sum / weight } : { col, row, weight }));
}

// How strong each bin is, 0 to 1: by the weight piled up (time, counters),
// against the strongest (or `top`, a scale shared with other heatmaps), on
// a curve so a lone point still shows; for averages, its value between the
// lowest and highest, where there's anything.
export function binShares(bins: HeatBin[], measure: HeatMeasure, top?: number): { col: number; row: number; share: number }[] {
  if (bins.length === 0) return [];
  if (measure === 'mean') {
    let lo = Infinity;
    let hi = -Infinity;
    for (const b of bins) {
      lo = Math.min(lo, b.value ?? 0);
      hi = Math.max(hi, b.value ?? 0);
    }
    const range = hi - lo;
    // Faint at the blur's edges, where hardly anything was.
    const most = binTop(bins);
    return bins.map((b) => ({ col: b.col, row: b.row, share: Math.min(1, b.weight / (most * 0.25)) * (range > 0 ? ((b.value ?? 0) - lo) / range : 1) }));
  }
  const hi = top ?? binTop(bins);
  return bins.map((b) => ({ col: b.col, row: b.row, share: hi > 0 ? Math.min(1, Math.pow(b.weight / hi, 0.6)) : 0 }));
}

// The heaviest bin's weight (to share a scale), or 0.
export const binTop = (bins: HeatBin[]) => bins.reduce((most, b) => Math.max(most, b.weight), 0);

// What a heatmap adds up to, for a legend: seconds, the counter's rise, or
// the range of the values.
export function heatTotal(heat: FieldHeat): { points: number; total: number; low: number | null; high: number | null } {
  const values = heat.points.map((p) => p.v).filter((v): v is number => v !== undefined);
  return {
    points: heat.points.length,
    total: heat.points.reduce((t, p) => t + p.w, 0),
    low: values.length ? values.reduce((a, b) => Math.min(a, b)) : null,
    high: values.length ? values.reduce((a, b) => Math.max(a, b)) : null
  };
}
