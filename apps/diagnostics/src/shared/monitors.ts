// Post-match monitors: automatic checks over a log that flag when something
// went wrong for long enough to matter (paired motors drawing unevenly, the
// intake arm twisting, a swerve module unlike the others, path tracking
// error in auto, wheel slip, cameras disagreeing with the fused pose).
//
// Each steps through the log every `stepSeconds`, within its gate (the
// robot enabled, or auto), and raises an alarm when its condition holds for
// at least its persistence. Every bound is in `monitorSettings`.
//
// Nothing here may touch Node or the DOM.

import type { LogEvent } from './events';

export interface Series {
  times: ArrayLike<number>;
  values: ArrayLike<number>;
}

// A signal by the name asked for (found by name or the end of its path),
// or null when the log hasn't it.
export type Lookup = (wanted: string) => { key: string; series: Series } | null;

export interface Gates {
  whole: [number, number];
  enabled: [number, number][];
  auto: [number, number][];
}

export interface MonitorAlarm {
  start: number;
  end: number;
  title: string;
  detail: string;
  // A signal to plot to see it.
  key: string | null;
  // Shown as a warning, or only as information (a surf's near miss).
  severity?: 'warning' | 'info';
}

export interface MonitorResult {
  id: string;
  name: string;
  // Whether it could run: every signal it needs was there.
  checked: boolean;
  missing: string[];
  alarms: MonitorAlarm[];
}

const robot = 'robot';

// Every bound, in one place.
export const monitorSettings = {
  stepSeconds: 0.02,
  pairs: [
    { id: 'pair-intake-rollers', name: 'Intake rollers (60/61)', a: ['left', `${robot}/intake/leftRollerMotor/statorCurrent`], b: ['right', `${robot}/intake/rightRollerMotor/statorCurrent`] },
    { id: 'pair-intake-arm', name: 'Intake arm (50/52)', a: ['left', `${robot}/intakeArm/left/motor/statorCurrent`], b: ['right', `${robot}/intakeArm/right/motor/statorCurrent`] },
    { id: 'pair-shooter', name: 'Shooter (58/59)', a: ['leader', `${robot}/shooter/motorLeader/statorCurrent`], b: ['follower', `${robot}/shooter/motorFollower/statorCurrent`] }
  ] as { id: string; name: string; a: [string, string]; b: [string, string] }[],
  pair: { share: 0.3, amps: 10, runningAmps: 5, persist: 1 },
  twist: { key: `${robot}/intakeArm/leftMinusRightMotorRot`, rotations: 2.0, persist: 0.5 },
  swerve: {
    current: (m: number) => `${robot}/drive/swerve/mod${m}/Drive Motor/statorCurrent`,
    velocity: (m: number) => `${robot}/drive/swerve/mod${m}/drive/currentVelMPS`,
    target: (m: number) => `${robot}/drive/swerve/mod${m}/drive/targetVelMPS`,
    times: 2, minAmps: 5, commandedMps: 1, persist: 1
  },
  path: {
    x: `${robot}/drive/controller/driveWithTrajectory/X Position Error`,
    y: `${robot}/drive/controller/driveWithTrajectory/Y Position Error`,
    theta: `${robot}/drive/controller/driveWithTrajectory/Theta Position Error`,
    // Logged only while a trajectory is followed: a value is stale after this.
    holdSeconds: 0.1,
    meters: 0.3, degrees: 10, persist: 0.5
  },
  // Wheel slip and drag: how far each module's wheel turned against how far
  // swerve kinematics says it should have gone for how the robot moved:
  // the robot's travel in its own frame, plus its turn about its centre at
  // the module's place (so a robot spinning in place has wheels turning and
  // no slip). Over the last `windowSeconds`, as average speeds: slip is a
  // wheel faster than that by more than `mps`, drag slower.
  //   The robot's motion is from odometry (the wheels and gyro alone: vision
  // moves the fused pose in jumps), logged a few times a second; the wheels'
  // travel from each drive motor's position, read at the same moments. By
  // travel rather than speed: the speeds are logged as often as the pose,
  // so between two samples a hard acceleration is missed, but what a
  // position says it turned includes everything in between.
  //   `metresPerRotation`: the drive motor's rotations to the wheel's metres
  // (RobotInfo's DRIVE_GEAR_RATIO × π × WHEEL_DIAMETER_METERS; the logs agree
  // to 1.5%). `modules`: each module's place from the robot's centre,
  // metres, x forward and y left, in the order the robot code logs them
  // (mod0 front left, mod1 front right, mod2 back left, mod3 back right;
  // TRACKWIDTH_METERS 0.635 along x, WHEELBASE_METERS 0.4826 along y).
  // Poses further apart than `maxGap`, or moving faster than `fastestMps`
  // (a reset), aren't motion.
  slip: {
    pose: `${robot}/drive/estimators/odometryOnly/pose`,
    position: (m: number) => `${robot}/drive/swerve/mod${m}/Drive Motor/positionRot`,
    metresPerRotation: 0.1432664756446991 * Math.PI * 0.0975325866,
    windowSeconds: 1,
    mps: 0.5,
    movingMps: 0.5,
    maxGap: 0.5,
    fastestMps: 6,
    persist: 0.5,
    modules: [[0.3175, 0.2413], [0.3175, -0.2413], [-0.3175, 0.2413], [-0.3175, -0.2413]] as [number, number][]
  },
  // Each camera's own measurement (MegaTag2 for where, MegaTag1 for which
  // way) against the fused pose then. A measurement counts for
  // `freshSeconds`; (0, 0) is none.
  vision: { fused: `${robot}/drive/estimators/fused/pose`, meters: 0.5, degrees: 10, persist: 1, freshSeconds: 0.5 },
  // Surfing: the robot riding up on the fuel pile. A tilt (pitch or roll)
  // over `degrees` for `persist`, with the fused pose in the pile zone, then
  // within `effectSeconds` wheel slip or growing path error. A tilt with
  // neither is a near miss. The pile zone is a guess (the fuel in the middle
  // of the field, the same for either alliance): set it to where the pile is.
  surf: {
    pitch: `${robot}/pigeon/Pitch`,
    roll: `${robot}/pigeon/Roll`,
    degrees: 8,
    persist: 0.15,
    pile: { x: [6.5, 10.0] as [number, number], y: [1.5, 6.5] as [number, number] },
    effectSeconds: 0.5,
    // Context recorded with each: roller bog, commanded spin, yaw kick.
    rollerSpeed: `${robot}/intake/currentVelocityRPS`,
    rollerTarget: `${robot}/intake/targetVelocityRPS`,
    commandedOmega: `${robot}/drive/controller/chassis speeds/omega RadPS`,
    yawRate: `${robot}/pigeon/Angular Velocity`,
    kickDegPerSec: 150
  }
};

// The monitors, for choosing them in a template.
export const monitorCatalog: { id: string; name: string }[] = [
  ...monitorSettings.pairs.map((p) => ({ id: p.id, name: `Paired-motor imbalance: ${p.name}` })),
  { id: 'intake-arm-twist', name: 'Intake arm twist' },
  { id: 'swerve-outlier', name: 'Swerve module outlier' },
  { id: 'path-position', name: 'Path tracking (position)' },
  { id: 'path-heading', name: 'Path tracking (heading)' },
  { id: 'wheel-slip', name: 'Wheel slip' },
  { id: 'wheel-drag', name: 'Wheel drag' },
  { id: 'vision-disagreement', name: 'Vision pose disagreement' },
  { id: 'surf', name: 'Surf detection' },
  { id: 'surf-near-miss', name: 'Surf near misses' }
];

// --- Engine ---

// The value holding at t (the last at or before it), or null before the
// first, or when the last is older than `hold`.
export function valueAt(series: Series, t: number, hold = Infinity): number | null {
  const { times, values } = series;
  let low = 0;
  let high = times.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (times[mid] <= t) low = mid + 1;
    else high = mid;
  }
  if (low === 0) return null;
  if (t - times[low - 1] > hold) return null;
  const value = values[low - 1];
  return Number.isFinite(value) ? value : null;
}

// How fast a signal changes at t, between its last sample there and the
// one at least `minGap` before it, or null without two such samples within
// `maxGap`. `angle`: the change is wrapped to ±π.
export function rateAt(series: Series, t: number, minGap: number, maxGap: number, angle = false): number | null {
  return rateOver(series, t, minGap, maxGap, angle)?.rate ?? null;
}

// The same, with the stretch it was taken over.
export function rateOver(series: Series, t: number, minGap: number, maxGap: number, angle = false): { rate: number; from: number; to: number } | null {
  const { times, values } = series;
  let low = 0;
  let high = times.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (times[mid] <= t) low = mid + 1;
    else high = mid;
  }
  const last = low - 1;
  if (last < 1 || t - times[last] > maxGap) return null;
  let first = last - 1;
  while (first > 0 && times[last] - times[first] < minGap) first -= 1;
  const gap = times[last] - times[first];
  if (gap < minGap || gap > maxGap) return null;
  const change = values[last] - values[first];
  return { rate: (angle ? Math.atan2(Math.sin(change), Math.cos(change)) : change) / gap, from: times[first], to: times[last] };
}

// A module's speed as swerve kinematics has it: the robot moving at (vx,
// vy) m/s on the field, facing `heading` rad and turning `omega` rad/s; the
// module at (mx, my) from its centre, in its frame (x forward, y left).
export function moduleSpeed(vx: number, vy: number, heading: number, omega: number, [mx, my]: [number, number]): number {
  const c = Math.cos(heading);
  const sn = Math.sin(heading);
  // The robot's velocity in its own frame, plus omega × the module's place.
  const rx = c * vx + sn * vy;
  const ry = -sn * vx + c * vy;
  return Math.hypot(rx - omega * my, ry + omega * mx);
}

// A series' value at t, between its samples on either side (no further
// apart than `maxGap`), or null.
function interpolate(series: Series, t: number, maxGap: number): number | null {
  const { times, values } = series;
  const n = times.length;
  if (n === 0 || t < times[0] || t > times[n - 1]) return null;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  if (times[lo] === t || n === 1) return values[lo];
  const span = times[hi] - times[lo];
  if (span > maxGap || span <= 0) return null;
  return values[lo] + ((values[hi] - values[lo]) * (t - times[lo])) / span;
}

// Each module's wheel against kinematics over the `window` seconds to t,
// as average speeds (m/s): how far its wheel turned, and how far it should
// have gone for how the robot moved (pose sample to pose sample, each
// stretch in the robot's frame at its middle). Null where it can't be told
// (no poses, a gap, a reset, a wheel's position missing).
export function wheelGaps(pose: { x: Series; y: Series; r: Series }, positions: Series[], t: number, window: number = monitorSettings.slip.windowSeconds): { wheel: number; expected: number }[] | null {
  const st = monitorSettings.slip;
  const times = pose.x.times;
  // The pose samples in [t - window, t].
  let last = -1;
  {
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= t) lo = mid + 1;
      else hi = mid;
    }
    last = lo - 1;
  }
  if (last < 1 || t - times[last] > st.maxGap) return null;
  let first = last;
  while (first > 0 && times[last] - times[first - 1] <= window + 1e-9) first -= 1;
  const duration = times[last] - times[first];
  if (first === last || duration < window * 0.6) return null;
  const expected = [0, 0, 0, 0].slice(0, positions.length);
  for (let i = first + 1; i <= last; i++) {
    const dt = times[i] - times[i - 1];
    if (dt <= 0 || dt > st.maxGap) return null;
    const dx = pose.x.values[i] - pose.x.values[i - 1];
    const dy = pose.y.values[i] - pose.y.values[i - 1];
    if (Math.hypot(dx, dy) / dt > st.fastestMps) return null;
    const dr = wrap(pose.r.values[i] - pose.r.values[i - 1]);
    const heading = pose.r.values[i - 1] + dr / 2;
    // moduleSpeed is linear in time: over dt, distances.
    for (let m = 0; m < positions.length; m++) expected[m] += moduleSpeed(dx, dy, heading, dr, st.modules[m]);
  }
  const gaps: { wheel: number; expected: number }[] = [];
  for (let m = 0; m < positions.length; m++) {
    // Each stretch's turn, as a size: a module can drive backwards to turn less.
    let turned = 0;
    let before = interpolate(positions[m], times[first], st.maxGap);
    if (before === null) return null;
    for (let i = first + 1; i <= last; i++) {
      const now = interpolate(positions[m], times[i], st.maxGap);
      if (now === null) return null;
      turned += Math.abs(now - before);
      before = now;
    }
    gaps.push({ wheel: (turned * st.metresPerRotation) / duration, expected: expected[m] / duration });
  }
  return gaps;
}

export const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length === 0 ? 0 : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// Where `check` holds for at least `persist` seconds, stepping through the
// spans: each alarm with the step where its value was largest.
export function persistent(
  spans: [number, number][],
  persist: number,
  check: (t: number) => { on: boolean; value: number; detail: string } | null,
  step = monitorSettings.stepSeconds
): { start: number; end: number; value: number; detail: string }[] {
  const found: { start: number; end: number; value: number; detail: string }[] = [];
  for (const [from, to] of spans) {
    let run: { start: number; end: number; value: number; detail: string } | null = null;
    const close = () => {
      if (run && run.end - run.start + step >= persist - 1e-9) found.push(run);
      run = null;
    };
    for (let t = from; t <= to + 1e-9; t += step) {
      const now = check(t);
      if (!now?.on) {
        close();
        continue;
      }
      if (!run) run = { start: t, end: t, value: now.value, detail: now.detail };
      else {
        run.end = t;
        if (now.value > run.value) {
          run.value = now.value;
          run.detail = now.detail;
        }
      }
    }
    close();
  }
  return found;
}

const fmt = (value: number, digits = 1) => value.toFixed(digits);
const seconds = (a: { start: number; end: number }) => `${fmt(a.end - a.start + monitorSettings.stepSeconds)} s`;
const wrap = (radians: number) => Math.atan2(Math.sin(radians), Math.cos(radians));

// Every monitor over a log. `available` is the log's signals, for finding
// the cameras.
export function runMonitors(lookup: Lookup, gates: Gates, available: readonly string[]): MonitorResult[] {
  const s = monitorSettings;
  const results: MonitorResult[] = [];
  const need = (id: string, name: string, wanted: string[]) => {
    const found = wanted.map((w) => lookup(w));
    const missing = wanted.filter((_, i) => !found[i]);
    const result: MonitorResult = { id, name, checked: missing.length === 0, missing, alarms: [] };
    results.push(result);
    return { result, found: found as ({ key: string; series: Series })[] };
  };

  // Paired motors drawing unevenly while they run.
  for (const pair of s.pairs) {
    const { result, found } = need(pair.id, `Paired-motor imbalance: ${pair.name}`, [pair.a[1], pair.b[1]]);
    if (!result.checked) continue;
    const [a, b] = found;
    result.alarms = persistent(gates.enabled, s.pair.persist, (t) => {
      const ia = valueAt(a.series, t);
      const ib = valueAt(b.series, t);
      if (ia === null || ib === null) return null;
      const big = Math.max(Math.abs(ia), Math.abs(ib));
      const diff = Math.abs(Math.abs(ia) - Math.abs(ib));
      return {
        on: big >= s.pair.runningAmps && diff > s.pair.amps && diff > s.pair.share * big,
        value: diff,
        detail: `${pair.a[0]} ${fmt(Math.abs(ia))} A, ${pair.b[0]} ${fmt(Math.abs(ib))} A (${Math.round((diff / big) * 100)}% apart)`
      };
    }).map((a) => ({ start: a.start, end: a.end, title: `${pair.name} imbalanced`, detail: `${a.detail}, for ${seconds(a)}`, key: found[0].key }));
  }

  // The intake arm's two motors apart.
  {
    const { result, found } = need('intake-arm-twist', 'Intake arm twist', [s.twist.key]);
    if (result.checked) {
      result.alarms = persistent(gates.enabled, s.twist.persist, (t) => {
        const v = valueAt(found[0].series, t);
        return v === null ? null : { on: Math.abs(v) > s.twist.rotations, value: Math.abs(v), detail: `left − right ${fmt(v, 2)} rot` };
      }).map((a) => ({ start: a.start, end: a.end, title: 'Intake arm twisted', detail: `${a.detail}, for ${seconds(a)}`, key: found[0].key }));
    }
  }

  // A swerve module drawing or turning far more than the others.
  {
    const modules = [0, 1, 2, 3];
    const wanted = modules.flatMap((m) => [s.swerve.current(m), s.swerve.velocity(m), s.swerve.target(m)]);
    const { result, found } = need('swerve-outlier', 'Swerve module outlier', wanted);
    if (result.checked) {
      const of = (m: number, k: number) => found[m * 3 + k].series;
      for (const m of modules) {
        const others = modules.filter((o) => o !== m);
        const alarms = persistent(gates.enabled, s.swerve.persist, (t) => {
          const targets = modules.map((o) => valueAt(of(o, 2), t));
          if (targets.some((v) => v === null) || median(targets.map((v) => Math.abs(v!))) <= s.swerve.commandedMps) return null;
          const current = valueAt(of(m, 0), t);
          const velocity = valueAt(of(m, 1), t);
          const otherCurrents = others.map((o) => valueAt(of(o, 0), t));
          const otherVelocities = others.map((o) => valueAt(of(o, 1), t));
          if (current === null || velocity === null || otherCurrents.some((v) => v === null) || otherVelocities.some((v) => v === null)) return null;
          const mc = median(otherCurrents.map((v) => Math.abs(v!)));
          const mv = median(otherVelocities.map((v) => Math.abs(v!)));
          const byCurrent = Math.abs(current) > s.swerve.minAmps && Math.abs(current) > s.swerve.times * mc;
          const byVelocity = Math.abs(velocity) > s.swerve.times * mv;
          const ratio = Math.max(mc > 0 ? Math.abs(current) / mc : 0, mv > 0 ? Math.abs(velocity) / mv : 0);
          return { on: byCurrent || byVelocity, value: ratio, detail: `${fmt(Math.abs(current))} A, ${fmt(Math.abs(velocity), 2)} m/s (others ${fmt(mc)} A, ${fmt(mv, 2)} m/s)` };
        });
        result.alarms.push(...alarms.map((a) => ({ start: a.start, end: a.end, title: `Swerve module ${m} unlike the others`, detail: `${a.detail}, for ${seconds(a)}`, key: found[m * 3].key })));
      }
      result.alarms.sort((a, b) => a.start - b.start);
    }
  }

  // Path tracking error in auto.
  {
    const { result, found } = need('path-position', 'Path tracking (position)', [s.path.x, s.path.y]);
    if (result.checked) {
      result.alarms = persistent(gates.auto, s.path.persist, (t) => {
        const x = valueAt(found[0].series, t, s.path.holdSeconds);
        const y = valueAt(found[1].series, t, s.path.holdSeconds);
        if (x === null || y === null) return null;
        const error = Math.hypot(x, y);
        return { on: error > s.path.meters, value: error, detail: `${fmt(error, 2)} m off the path` };
      }).map((a) => ({ start: a.start, end: a.end, title: 'Off the path in auto', detail: `up to ${a.detail}, for ${seconds(a)}`, key: found[0].key }));
    }
  }
  {
    const { result, found } = need('path-heading', 'Path tracking (heading)', [s.path.theta]);
    if (result.checked) {
      // Logged in radians (its largest is about π).
      result.alarms = persistent(gates.auto, s.path.persist, (t) => {
        const theta = valueAt(found[0].series, t, s.path.holdSeconds);
        if (theta === null) return null;
        const degrees = Math.abs(wrap(theta)) * 180 / Math.PI;
        return { on: degrees > s.path.degrees, value: degrees, detail: `${fmt(degrees)}° off the path's heading` };
      }).map((a) => ({ start: a.start, end: a.end, title: "Off the path's heading in auto", detail: `up to ${a.detail}, for ${seconds(a)}`, key: found[0].key }));
    }
  }

  // Wheel slip (a wheel faster than kinematics says, for how the robot
  // moved) and drag (slower): see monitorSettings.slip.
  {
    const modules = [0, 1, 2, 3];
    const pose = s.slip.pose;
    const wanted = [`${pose}/translation/x`, `${pose}/translation/y`, `${pose}/rotation/value`, ...modules.map((m) => s.slip.position(m))];
    const slip = need('wheel-slip', 'Wheel slip', wanted);
    const drag = need('wheel-drag', 'Wheel drag', wanted);
    if (slip.result.checked) {
      const found = slip.found;
      const [px, py, pr] = found.map((f) => f.series);
      const wheels = found.slice(3).map((f) => f.series);
      // Worked out once a step for every module, and used by both.
      const cache = new Map<number, ReturnType<typeof wheelGaps>>();
      const gapsAt = (t: number) => {
        if (!cache.has(t)) cache.set(t, wheelGaps({ x: px, y: py, r: pr }, wheels, t));
        return cache.get(t)!;
      };
      for (const m of modules) {
        for (const [result, sign, title] of [[slip.result, 1, 'wheel slipping'], [drag.result, -1, 'wheel dragging']] as const) {
          const alarms = persistent(gates.enabled, s.slip.persist, (t) => {
            const gap = gapsAt(t)?.[m];
            if (!gap) return null;
            const over = sign * (gap.wheel - gap.expected);
            const moving = Math.max(gap.wheel, gap.expected) > s.slip.movingMps;
            return { on: moving && over > s.slip.mps, value: over, detail: `wheel ${fmt(gap.wheel, 2)} m/s, ${fmt(gap.expected, 2)} m/s for how the robot moved (over ${fmt(s.slip.windowSeconds)} s)` };
          });
          result.alarms.push(...alarms.map((a) => ({ start: a.start, end: a.end, title: `Module ${m} ${title}`, detail: `${a.detail}, for ${seconds(a)}`, key: found[3 + m].key })));
        }
      }
      slip.result.alarms.sort((a, b) => a.start - b.start);
      drag.result.alarms.sort((a, b) => a.start - b.start);
    }
  }

  // Each camera's own measurement against the fused pose.
  {
    const cameras = visionCameras(available);
    const fused = s.vision.fused;
    const fusedWanted = [`${fused}/translation/x`, `${fused}/translation/y`, `${fused}/rotation/value`];
    const { result, found } = need('vision-disagreement', 'Vision pose disagreement', cameras.length ? fusedWanted : [...fusedWanted, 'providers/<camera>/mt2']);
    if (result.checked) {
      const [fx, fy, fr] = found.map((f) => f.series);
      for (const camera of cameras) {
        const mx = lookup(`${camera.provider}/mt2/translation/x`);
        const my = lookup(`${camera.provider}/mt2/translation/y`);
        const heading = lookup(`${camera.provider}/mt1/rotation/value`);
        if (!mx || !my) continue;
        const alarms = persistent(gates.enabled, s.vision.persist, (t) => {
          const d = measurementGap({ x: fx, y: fy, r: fr }, { x: mx.series, y: my.series, r: heading?.series ?? null }, t, s.vision.freshSeconds);
          if (!d) return null;
          return { on: d.meters > s.vision.meters || (d.degrees ?? 0) > s.vision.degrees, value: d.meters, detail: `${fmt(d.meters, 2)} m${d.degrees === null ? '' : `, ${fmt(d.degrees)}°`} from the fused pose` };
        });
        result.alarms.push(...alarms.map((a) => ({ start: a.start, end: a.end, title: `${camera.name} camera disagrees with the fused pose`, detail: `up to ${a.detail}, for ${seconds(a)}`, key: mx.key })));
      }
      result.alarms.sort((a, b) => a.start - b.start);
    }
  }
  results.push(...surfMonitors(lookup, gates, need));
  return results;
}

// Surfing (see monitorSettings.surf): surfs, and near misses, each in auto
// or teleop, with what explains them.
function surfMonitors(
  lookup: Lookup,
  gates: Gates,
  need: (id: string, name: string, wanted: string[]) => { result: MonitorResult; found: { key: string; series: Series }[] }
): MonitorResult[] {
  const s = monitorSettings;
  const fused = s.vision.fused;
  const odometry = s.slip.pose;
  const wanted = [s.surf.pitch, s.surf.roll, `${fused}/translation/x`, `${fused}/translation/y`,
    `${odometry}/translation/x`, `${odometry}/translation/y`, `${odometry}/rotation/value`, ...[0, 1, 2, 3].map((m) => s.slip.position(m))];
  const surfs = need('surf', 'Surf detection', wanted);
  const nearMisses: MonitorResult = { id: 'surf-near-miss', name: 'Surf near misses', checked: surfs.result.checked, missing: surfs.result.missing, alarms: [] };
  if (!surfs.result.checked) return [nearMisses];
  const [pitch, roll, fx, fy, ox, oy, or] = surfs.found.slice(0, 7).map((f) => f.series);
  const wheels = surfs.found.slice(7).map((f) => f.series);
  const pathX = lookup(s.path.x)?.series ?? null;
  const pathY = lookup(s.path.y)?.series ?? null;
  const optional = (key: string) => lookup(key)?.series ?? null;
  const rollerSpeed = optional(s.surf.rollerSpeed);
  const rollerTarget = optional(s.surf.rollerTarget);
  const omega = optional(s.surf.commandedOmega);
  const yawRate = optional(s.surf.yawRate);

  const inPile = (t: number) => {
    const x = valueAt(fx, t);
    const y = valueAt(fy, t);
    return x !== null && y !== null && x >= s.surf.pile.x[0] && x <= s.surf.pile.x[1] && y >= s.surf.pile.y[0] && y <= s.surf.pile.y[1];
  };
  // Wheel slip at t, as the slip monitor has it (over the half second
  // before): a wheel turning faster than kinematics says for how the robot
  // moved (spinning free on the pile).
  const slipping = (t: number) =>
    wheelGaps({ x: ox, y: oy, r: or }, wheels, t, s.surf.effectSeconds)?.some((g) => g.wheel - g.expected > s.slip.mps) ?? false;
  // Path error over the bound, and rising.
  const pathGrowing = (t: number) => {
    if (!pathX || !pathY) return false;
    const now = [valueAt(pathX, t, s.path.holdSeconds), valueAt(pathY, t, s.path.holdSeconds)];
    const before = [valueAt(pathX, t - 0.1, s.path.holdSeconds), valueAt(pathY, t - 0.1, s.path.holdSeconds)];
    if (now.some((v) => v === null) || before.some((v) => v === null)) return false;
    const error = Math.hypot(now[0]!, now[1]!);
    return error > s.path.meters && error > Math.hypot(before[0]!, before[1]!);
  };
  const within = (spans: [number, number][], t: number) => spans.find(([a, b]) => t >= a && t <= b) ?? null;

  const tilts = persistent(gates.enabled, s.surf.persist, (t) => {
    const p = valueAt(pitch, t);
    const r = valueAt(roll, t);
    if (p === null || r === null) return null;
    const tilt = Math.max(Math.abs(p), Math.abs(r));
    return { on: tilt > s.surf.degrees, value: tilt, detail: `${Math.abs(p) >= Math.abs(r) ? 'pitch' : 'roll'} ${fmt(tilt)}°` };
  });
  for (const tilt of tilts) {
    // Only in the pile: not crossing a field element, or being shoved.
    if (!inPile(tilt.start)) continue;
    const auto = within(gates.auto, tilt.start);
    const when = auto ? `auto, ${fmt(tilt.start - auto[0])} s in` : 'teleop';
    let slip = false;
    let path = false;
    for (let t = tilt.start; t <= tilt.start + s.surf.effectSeconds + 1e-9; t += s.stepSeconds) {
      slip ||= slipping(t);
      path ||= pathGrowing(t);
    }
    // What explains it: the rollers bogging, how hard it was spinning, and
    // whether it was hit (yaw rate unlike what was commanded).
    const context: string[] = [];
    const rs = rollerSpeed ? valueAt(rollerSpeed, tilt.start) : null;
    const rt = rollerTarget ? valueAt(rollerTarget, tilt.start) : null;
    if (rs !== null && rt !== null && rt !== 0) context.push(`rollers ${fmt(Math.abs(rs))} of ${fmt(Math.abs(rt))} rot/s`);
    if (omega) {
      const [from, to] = auto ? [auto[0] + 1, auto[0] + 4] : [tilt.start - 1, tilt.start];
      let spin = 0;
      for (let t = from; t <= to; t += s.stepSeconds) spin = Math.max(spin, Math.abs(valueAt(omega, t) ?? 0));
      context.push(`commanded spin up to ${Math.round(spin * 180 / Math.PI)}°/s`);
    }
    if (omega && yawRate) {
      // The gap between how fast it turned and how fast it was told to. A
      // command it can't reach (it often asks for far more than it turns)
      // isn't a hit; turning more than asked, or the other way, is.
      let kick = { gap: 0, measured: 0, commanded: 0 };
      let hit = false;
      for (let t = tilt.start - 0.5; t <= tilt.start + s.surf.effectSeconds; t += s.stepSeconds) {
        const measured = valueAt(yawRate, t);
        const radians = valueAt(omega, t);
        if (measured === null || radians === null) continue;
        const commanded = radians * 180 / Math.PI;
        const gap = Math.abs(measured - commanded);
        if (gap > kick.gap) kick = { gap, measured, commanded };
        const beyond = Math.abs(measured) > Math.abs(commanded) || (Math.sign(measured) !== Math.sign(commanded) && Math.abs(measured) > 50);
        if (gap > s.surf.kickDegPerSec && beyond) hit = true;
      }
      context.push(`yaw kick ${Math.round(kick.gap)}°/s (turned ${Math.round(kick.measured)}°/s, told ${Math.round(kick.commanded)}°/s)${hit ? ', hit?' : ''}`);
    }
    const effects = [slip ? 'wheel slip' : '', path ? 'path error growing' : ''].filter(Boolean);
    const alarm: MonitorAlarm = {
      start: tilt.start,
      end: tilt.end,
      title: effects.length ? `Surf (${auto ? 'auto' : 'teleop'})` : `Surf near miss (${auto ? 'auto' : 'teleop'})`,
      detail: [`${tilt.detail} in the pile, ${when}`, effects.length ? effects.join(' and ') : 'no slip or path error', ...context].join('; '),
      key: surfs.found[Math.abs(valueAt(pitch, tilt.start) ?? 0) >= Math.abs(valueAt(roll, tilt.start) ?? 0) ? 0 : 1].key,
      severity: effects.length ? 'warning' : 'info'
    };
    (effects.length ? surfs.result.alarms : nearMisses.alarms).push(alarm);
  }
  return [nearMisses];
}

// How far a camera's latest measurement (if it's fresh, and not (0, 0))
// is from the fused pose at t. Its heading only when it measures one.
export function measurementGap(
  fused: { x: Series; y: Series; r: Series },
  camera: { x: Series; y: Series; r: Series | null },
  t: number,
  fresh: number
): { meters: number; degrees: number | null } | null {
  const cx = valueAt(camera.x, t, fresh);
  const cy = valueAt(camera.y, t, fresh);
  if (cx === null || cy === null || (cx === 0 && cy === 0)) return null;
  const fx = valueAt(fused.x, t);
  const fy = valueAt(fused.y, t);
  if (fx === null || fy === null) return null;
  const cr = camera.r ? valueAt(camera.r, t, fresh) : null;
  const fr = valueAt(fused.r, t);
  const degrees = cr === null || fr === null || cr === 0 ? null : Math.abs(wrap(cr - fr)) * 180 / Math.PI;
  return { meters: Math.hypot(cx - fx, cy - fy), degrees };
}

// How far one pose is from another at t.
export function poseGap(a: { x: Series; y: Series; r: Series }, b: { x: Series; y: Series; r: Series }, t: number): { meters: number; degrees: number } | null {
  const v = [a.x, a.y, a.r, b.x, b.y, b.r].map((s) => valueAt(s, t));
  if (v.some((x) => x === null)) return null;
  const [ax, ay, ar, bx, by, br] = v as number[];
  return { meters: Math.hypot(ax - bx, ay - by), degrees: Math.abs(wrap(ar - br)) * 180 / Math.PI };
}

// The cameras the robot reads (`providers/llLeft`), named for people
// ("Left"), with where their logging is.
export function visionCameras(available: readonly string[]): { name: string; provider: string }[] {
  const found = new Map<string, string>();
  for (const key of available) {
    const m = /^(.*\/providers\/(ll[^/]+))\/mt2\/translation\/x$/i.exec(key);
    if (m) found.set(m[2].replace(/^ll/i, '') || m[2], m[1]);
  }
  return [...found.entries()].map(([name, provider]) => ({ name, provider }));
}

// Each alarm as an event: on the Signals timeline, and a report's problems.
export function monitorEvents(results: MonitorResult[]): LogEvent[] {
  return results.flatMap((result) => result.alarms.map((alarm): LogEvent => ({
    id: `monitor:${result.id}:${alarm.title}:${alarm.start.toFixed(2)}`,
    kind: 'monitor',
    severity: alarm.severity ?? 'warning',
    start: alarm.start,
    end: alarm.end,
    title: alarm.title,
    detail: alarm.detail,
    count: 1,
    key: alarm.key
  })));
}
