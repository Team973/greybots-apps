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
  slip: { pose: `${robot}/drive/estimators/fused/pose`, mps: 0.5, maxTurnRadPerSec: 0.5, movingMps: 0.5, window: 0.1, persist: 0.5 },
  vision: { meters: 0.5, degrees: 10, persist: 1 }
};

// The monitors, for choosing them in a template.
export const monitorCatalog: { id: string; name: string }[] = [
  ...monitorSettings.pairs.map((p) => ({ id: p.id, name: `Paired-motor imbalance: ${p.name}` })),
  { id: 'intake-arm-twist', name: 'Intake arm twist' },
  { id: 'swerve-outlier', name: 'Swerve module outlier' },
  { id: 'path-position', name: 'Path tracking (position)' },
  { id: 'path-heading', name: 'Path tracking (heading)' },
  { id: 'wheel-slip', name: 'Wheel slip' },
  { id: 'vision-disagreement', name: 'Vision pose disagreement' }
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

  // Wheel slip: a module's speed unlike the robot's own (from the fused
  // pose), while it isn't turning much.
  {
    const modules = [0, 1, 2, 3];
    const pose = s.slip.pose;
    const wanted = [`${pose}/translation/x`, `${pose}/translation/y`, `${pose}/rotation/value`, ...modules.map((m) => s.swerve.velocity(m))];
    const { result, found } = need('wheel-slip', 'Wheel slip', wanted);
    if (result.checked) {
      const [px, py, pr] = found.map((f) => f.series);
      const motion = (t: number) => {
        const x1 = valueAt(px, t); const y1 = valueAt(py, t); const r1 = valueAt(pr, t);
        const x0 = valueAt(px, t - s.slip.window); const y0 = valueAt(py, t - s.slip.window); const r0 = valueAt(pr, t - s.slip.window);
        if ([x1, y1, r1, x0, y0, r0].some((v) => v === null)) return null;
        return { speed: Math.hypot(x1! - x0!, y1! - y0!) / s.slip.window, turn: Math.abs(wrap(r1! - r0!)) / s.slip.window };
      };
      for (const m of modules) {
        const alarms = persistent(gates.enabled, s.slip.persist, (t) => {
          const robotMotion = motion(t);
          const wheel = valueAt(found[3 + m].series, t);
          if (!robotMotion || wheel === null || robotMotion.turn > s.slip.maxTurnRadPerSec) return null;
          const gap = Math.abs(Math.abs(wheel) - robotMotion.speed);
          const moving = Math.max(Math.abs(wheel), robotMotion.speed) > s.slip.movingMps;
          return { on: moving && gap > s.slip.mps, value: gap, detail: `wheel ${fmt(Math.abs(wheel), 2)} m/s, robot ${fmt(robotMotion.speed, 2)} m/s` };
        });
        result.alarms.push(...alarms.map((a) => ({ start: a.start, end: a.end, title: `Module ${m} wheel slipping`, detail: `${a.detail}, for ${seconds(a)}`, key: found[3 + m].key })));
      }
      result.alarms.sort((a, b) => a.start - b.start);
    }
  }

  // Each camera's own pose estimate against the fused one.
  {
    const cameras = visionEstimators(available);
    const pose = s.slip.pose;
    const fusedWanted = [`${pose}/translation/x`, `${pose}/translation/y`, `${pose}/rotation/value`];
    const { result, found } = need('vision-disagreement', 'Vision pose disagreement', cameras.length ? fusedWanted : [...fusedWanted, 'estimators/<camera>Only/pose']);
    if (result.checked) {
      const [fx, fy, fr] = found.map((f) => f.series);
      for (const camera of cameras) {
        const parts = ['x', 'y'].map((c) => lookup(`${camera.pose}/translation/${c}`)).concat(lookup(`${camera.pose}/rotation/value`));
        if (parts.some((p) => !p)) continue;
        const [cx, cy, cr] = parts.map((p) => p!.series);
        const alarms = persistent(gates.enabled, s.vision.persist, (t) => {
          const d = poseGap({ x: fx, y: fy, r: fr }, { x: cx, y: cy, r: cr }, t);
          if (!d) return null;
          return { on: d.meters > s.vision.meters || d.degrees > s.vision.degrees, value: d.meters, detail: `${fmt(d.meters, 2)} m, ${fmt(d.degrees)}° from the fused pose` };
        });
        result.alarms.push(...alarms.map((a) => ({ start: a.start, end: a.end, title: `${camera.name} camera disagrees with the fused pose`, detail: `up to ${a.detail}, for ${seconds(a)}`, key: parts[0]!.key })));
      }
      result.alarms.sort((a, b) => a.start - b.start);
    }
  }
  return results;
}

// How far one pose is from another at t.
export function poseGap(a: { x: Series; y: Series; r: Series }, b: { x: Series; y: Series; r: Series }, t: number): { meters: number; degrees: number } | null {
  const v = [a.x, a.y, a.r, b.x, b.y, b.r].map((s) => valueAt(s, t));
  if (v.some((x) => x === null)) return null;
  const [ax, ay, ar, bx, by, br] = v as number[];
  return { meters: Math.hypot(ax - bx, ay - by), degrees: Math.abs(wrap(ar - br)) * 180 / Math.PI };
}

// The cameras' own pose estimators (`estimators/leftLLOnly/pose`), named
// as their camera ("left").
export function visionEstimators(available: readonly string[]): { name: string; pose: string }[] {
  const found = new Map<string, string>();
  for (const key of available) {
    const m = /^(.*\/estimators\/([^/]+?)Only\/pose)\/translation\/x$/i.exec(key);
    if (m && !/odometry/i.test(m[2])) found.set(m[2].replace(/ll$/i, '').replace(/LL$/, '') || m[2], m[1]);
  }
  return [...found.entries()].map(([name, pose]) => ({ name, pose }));
}
