// The Vision System report: for each camera the robot reads, how often it
// had good data and used it, against how often it was thrown out; when, as
// a heatmap over time; and how far its measurements were from the fused
// pose. From the counters the robot logs for each camera (`perf/data
// received`, `perf/rejected …`), which only ever go up.
//
// Nothing here may touch Node or the DOM.

import { fieldHeat, type FieldHeat } from './field-heat';
import { measurementGap, monitorSettings, valueAt, visionCameras, type Lookup, type Series } from './monitors';

export type VisionState = 'valid' | 'thrown' | 'noTargets' | 'noData';

export const visionStates: { state: VisionState; label: string }[] = [
  { state: 'valid', label: 'Valid targets (used)' },
  { state: 'thrown', label: 'Thrown out' },
  { state: 'noTargets', label: 'No targets in view' },
  { state: 'noData', label: 'No sample data' }
];

// Which state each counter counts.
export function counterState(name: string): VisionState | null {
  const n = name.toLowerCase();
  if (n === 'data received') return 'valid';
  if (n === 'rejected no tags') return 'noTargets';
  if (n === 'rejected stale heartbeat' || n === 'rejected no data') return 'noData';
  if (n.startsWith('rejected ')) return 'thrown';
  return null;
}

export type VisionCounts = Record<VisionState, number>;
const zero = (): VisionCounts => ({ valid: 0, thrown: 0, noTargets: 0, noData: 0 });

export interface VisionCamera {
  name: string;
  totals: VisionCounts;
  // Thrown out, by why ("gyro not level"), most first.
  thrownBy: { reason: string; count: number }[];
  // Of the frames it had targets in (used or thrown out), the share used.
  usedShare: number | null;
  // Each bin's counts, for the heatmap.
  bins: VisionCounts[];
  // Its measurements against the fused pose: how far, on average and at
  // most, and how many of its measurements there were.
  pose: { measurements: number; meanMeters: number | null; maxMeters: number | null; maxDegrees: number | null };
  // Each of those measurements, for the disagreement charts and the field:
  // when, where it put the robot (MegaTag 2's x and y, MegaTag 1's heading
  // where it gave one; radians), and how far that was from the fused pose.
  // Not in reports made before these were kept.
  measured?: VisionTrack & { meters: number[]; degrees: (number | null)[] };
  // Where on the field it had valid targets: its frames used, by where the
  // fused pose was when they came. Not in reports made before this.
  validHeat?: FieldHeat;
}

// Poses over time, rounded to a millimetre and a thousandth of a radian.
export interface VisionTrack {
  times: number[];
  x: number[];
  y: number[];
  heading: (number | null)[];
}

export interface VisionSummary {
  // The heatmap's bins, a second each, in seconds on the log's timeline.
  bins: [number, number][];
  cameras: VisionCamera[];
  // The fused pose over the spans, to draw the cameras' measurements against.
  fused?: VisionTrack;
}

const round = (value: number, places = 3) => Math.round(value * 10 ** places) / 10 ** places;
const inAny = (spans: [number, number][], t: number) => spans.some(([a, b]) => t >= a && t <= b);

// How much a counter went up between a and b. Before its first value it's
// taken to have been at that value (logging started part way through); if
// it went down (the robot code restarted), what it reached since counts.
export function counterIncrease(series: Series, a: number, b: number): number {
  if (series.times.length === 0) return 0;
  const first = series.values[0];
  const at = (t: number) => valueAt(series, t) ?? first;
  const from = at(a);
  const to = at(b);
  return to >= from ? to - from : to;
}

// Where a camera's frames were used, from each of its valid counters: a
// point for each rise, weighted by it.
function validHeat(where: { times: ArrayLike<number>; x: ArrayLike<number>; y: ArrayLike<number> }, counters: Series[], spans: [number, number][]): FieldHeat {
  // The fused pose is logged a few times a second; a still robot's less.
  return { measure: 'increase', points: counters.flatMap((counter) => fieldHeat(where, counter, 'increase', spans, 5).points) };
}

// --- Where on the field ---

// The 2026 field (metres, blue alliance wall at x = 0), and where its zones
// end: each alliance's zone from its wall to its hub's line, the neutral
// zone between. The zone lines are taken from the hubs' centres; check them
// against the game manual.
export const fieldZones = { length: 16.541, width: 8.069, allianceDepth: 4.63 };

export type Alliance = 'blue' | 'red';
export type FieldZone = 'ours' | 'neutral' | 'theirs';
export const zoneLabels: Record<FieldZone, string> = { ours: 'Our zone', neutral: 'Neutral zone', theirs: 'Their zone' };

// The alliance, from where the robot was when auto started (it starts in
// its own zone): the first fused pose at or after auto's start, or the
// first at all. Null with no pose. The logs don't say it otherwise.
export function allianceFrom(track: VisionTrack | undefined, autoStart: number | null): Alliance | null {
  if (!track || track.times.length === 0) return null;
  const i = autoStart === null ? 0 : Math.max(0, track.times.findIndex((t) => t >= autoStart));
  return track.x[i] < fieldZones.length / 2 ? 'blue' : 'red';
}

// Which zone a position is in, and which side, as the alliance's drivers
// see it from their wall (blue looks along +x, so its left is +y).
export function zoneAt(x: number, y: number, alliance: Alliance): { zone: FieldZone; side: 'left' | 'right' } {
  const fromOwnWall = alliance === 'blue' ? x : fieldZones.length - x;
  const zone: FieldZone = fromOwnWall <= fieldZones.allianceDepth ? 'ours'
    : fromOwnWall >= fieldZones.length - fieldZones.allianceDepth ? 'theirs' : 'neutral';
  const upper = y > fieldZones.width / 2;
  return { zone, side: (alliance === 'blue') === upper ? 'left' : 'right' };
}

// The bins: the spans' extent cut into whole seconds (the last one shorter
// if it ends part way through one).
export function visionBins(spans: [number, number][], seconds = 1): [number, number][] {
  if (spans.length === 0) return [];
  const start = Math.min(...spans.map((s) => s[0]));
  const end = Math.max(...spans.map((s) => s[1]));
  const n = Math.max(1, Math.ceil((end - start) / seconds - 1e-9));
  return Array.from({ length: n }, (_, i): [number, number] => [start + i * seconds, Math.min(end, start + (i + 1) * seconds)]);
}

export function visionSummary(lookup: Lookup, available: readonly string[], spans: [number, number][], binSeconds = 1): VisionSummary {
  const bins = visionBins(spans, binSeconds);
  const fused = monitorSettings.vision.fused;
  const fx = lookup(`${fused}/translation/x`)?.series;
  const fy = lookup(`${fused}/translation/y`)?.series;
  const fr = lookup(`${fused}/rotation/value`)?.series;
  // The fused pose as a track, for the cameras' heatmaps.
  const where = fx && fy ? { times: fx.times, x: fx.values, y: Array.from(fx.times, (t) => valueAt(fy, t) ?? 0) } : null;
  const cameras = visionCameras(available).map((camera): VisionCamera => {
    const prefix = `${camera.provider}/perf/`;
    const counters = available
      .filter((key) => key.startsWith(prefix))
      .map((key) => ({ name: key.slice(prefix.length), state: counterState(key.slice(prefix.length)), series: lookup(key)?.series ?? null }))
      .filter((c): c is { name: string; state: VisionState; series: Series } => c.state !== null && c.series !== null);

    const totals = zero();
    const thrown = new Map<string, number>();
    for (const counter of counters) {
      const count = spans.reduce((total, [a, b]) => total + counterIncrease(counter.series, a, b), 0);
      totals[counter.state] += count;
      if (counter.state === 'thrown') thrown.set(counter.name.replace(/^rejected /i, ''), count);
    }
    const binCounts = bins.map(([a, b]) => {
      const counts = zero();
      for (const counter of counters) counts[counter.state] += counterIncrease(counter.series, a, b);
      return counts;
    });

    // Its measurements against the fused pose, at each fresh measurement.
    let measurements = 0;
    let sum = 0;
    let maxMeters: number | null = null;
    let maxDegrees: number | null = null;
    const mx = lookup(`${camera.provider}/mt2/translation/x`)?.series;
    const my = lookup(`${camera.provider}/mt2/translation/y`)?.series;
    const heading = lookup(`${camera.provider}/mt1/rotation/value`)?.series ?? null;
    const measured: NonNullable<VisionCamera['measured']> = { times: [], x: [], y: [], heading: [], meters: [], degrees: [] };
    if (mx && my && fx && fy && fr) {
      for (let i = 0; i < mx.times.length; i++) {
        const t = mx.times[i];
        if (!inAny(spans, t)) continue;
        const gap = measurementGap({ x: fx, y: fy, r: fr }, { x: mx, y: my, r: heading }, t, monitorSettings.vision.freshSeconds);
        if (!gap) continue;
        const h = heading ? valueAt(heading, t, monitorSettings.vision.freshSeconds) : null;
        measured.times.push(round(t));
        measured.x.push(round(Number(mx.values[i])));
        measured.y.push(round(valueAt(my, t) ?? 0));
        measured.heading.push(h === null || h === 0 ? null : round(h));
        measured.meters.push(round(gap.meters));
        measured.degrees.push(gap.degrees === null ? null : round(gap.degrees, 2));
        measurements += 1;
        sum += gap.meters;
        maxMeters = Math.max(maxMeters ?? 0, gap.meters);
        if (gap.degrees !== null) maxDegrees = Math.max(maxDegrees ?? 0, gap.degrees);
      }
    }
    const withTargets = totals.valid + totals.thrown;
    return {
      name: camera.name,
      totals,
      thrownBy: [...thrown.entries()].map(([reason, count]) => ({ reason, count })).filter((r) => r.count > 0).sort((a, b) => b.count - a.count),
      usedShare: withTargets > 0 ? totals.valid / withTargets : null,
      bins: binCounts,
      pose: { measurements, meanMeters: measurements ? sum / measurements : null, maxMeters, maxDegrees },
      measured,
      ...(where ? { validHeat: validHeat(where, counters.filter((c) => c.state === 'valid').map((c) => c.series), spans) } : {})
    };
  });
  const track: VisionTrack = { times: [], x: [], y: [], heading: [] };
  if (fx && fy && fr) {
    for (let i = 0; i < fx.times.length; i++) {
      const t = fx.times[i];
      // And the one before each span, so the pose is there from its start.
      const next = i + 1 < fx.times.length ? fx.times[i + 1] : Infinity;
      if (!inAny(spans, t) && !spans.some(([a]) => t < a && next > a)) continue;
      track.times.push(round(t));
      track.x.push(round(Number(fx.values[i])));
      track.y.push(round(valueAt(fy, t) ?? 0));
      track.heading.push(round(valueAt(fr, t) ?? 0));
    }
  }
  return { bins, cameras, fused: track };
}
