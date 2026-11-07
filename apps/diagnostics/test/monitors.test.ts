// The post-match monitors and the vision summary, on made-up signals.

import assert from 'node:assert/strict';
import { monitorSettings, persistent, rateAt, runMonitors, valueAt, type Gates, type Series } from '@shared/monitors';
import { matchKey } from '@shared/signal-match';
import { allianceFrom, counterIncrease, counterState, visionBins, visionSummary, zoneAt } from '@shared/vision';

// A signal from (time, value) pairs.
const series = (points: [number, number][]): Series => ({ times: points.map((p) => p[0]), values: points.map((p) => p[1]) });
// Steady at `base`, `value` from `from` to `to`, sampled every 20 ms.
const step = (base: number, value: number, from: number, to: number, end = 20): Series => {
  const points: [number, number][] = [];
  for (let t = 0; t <= end + 1e-9; t += 0.02) points.push([t, t >= from && t <= to ? value : base]);
  return series(points);
};
const logOf = (signals: Record<string, Series>) => {
  const available = Object.keys(signals);
  return {
    available,
    lookup: (wanted: string) => {
      const key = matchKey(wanted, available).key;
      return key ? { key, series: signals[key] } : null;
    }
  };
};
const gates: Gates = { whole: [0, 20], enabled: [[0, 20]], auto: [[0, 5]] };
const run = (signals: Record<string, Series>, g = gates) => {
  const log = logOf(signals);
  return new Map(runMonitors(log.lookup, g, log.available).map((r) => [r.id, r]));
};
const R = '/Robot/robot';

// --- The engine ---
const s = series([[1, 10], [2, 20]]);
assert.equal(valueAt(s, 0.5), null);
assert.equal(valueAt(s, 1.5), 10);
assert.equal(valueAt(s, 3), 20);
assert.equal(valueAt(s, 3, 0.5), null, 'stale');
// A rate needs two samples far enough apart.
assert.equal(rateAt(series([[0, 0], [0.1, 1], [0.5, 5]]), 0.5, 0.2, 1), 10);
assert.equal(rateAt(series([[0, 0], [0.1, 1]]), 0.1, 0.2, 1), null);
// Wrapped angles: from just under π to just over -π is a small turn.
const turn = rateAt(series([[0, 3.1], [0.5, -3.1]]), 0.5, 0.2, 1, true)!;
assert.ok(Math.abs(turn - (2 * Math.PI - 6.2) / 0.5) < 1e-9);
// Persistence: 0.4 s isn't enough for 0.5 s; 0.6 s is.
const on = (from: number, to: number) => (t: number) => ({ on: t >= from && t <= to, value: t, detail: '' });
assert.equal(persistent([[0, 5]], 0.5, on(1, 1.4)).length, 0);
const found = persistent([[0, 5]], 0.5, on(1, 1.6));
assert.equal(found.length, 1);
assert.ok(Math.abs(found[0].start - 1) < 0.03 && Math.abs(found[0].end - 1.6) < 0.03);
// Only within the gate.
assert.equal(persistent([[2, 5]], 0.5, on(1, 1.6)).length, 0);

// --- Paired motors ---
{
  const pair = (left: Series, right: Series) => run({ [`${R}/intake/leftRollerMotor/statorCurrent`]: left, [`${R}/intake/rightRollerMotor/statorCurrent`]: right }).get('pair-intake-rollers')!;
  // 40 A against 10 A (opposed, so negative) for 1.2 s: apart by 30 A and 75%.
  const uneven = pair(step(20, 40, 5, 6.2), step(-20, -10, 5, 6.2));
  assert.equal(uneven.checked, true);
  assert.equal(uneven.alarms.length, 1);
  assert.match(uneven.alarms[0].detail, /left 40\.0 A, right 10\.0 A \(75% apart\)/);
  // Only 0.8 s: not for long enough.
  assert.equal(pair(step(20, 40, 5, 5.8), step(20, 10, 5, 5.8)).alarms.length, 0);
  // 30% apart but only 6 A: under the 10 A floor.
  assert.equal(pair(step(20, 20, 5, 7), step(20, 14, 5, 7)).alarms.length, 0);
  // Not running: both idle.
  assert.equal(pair(step(1, 1, 0, 0), step(0, 0, 0, 0)).alarms.length, 0);
  // A pair the log hasn't is not checked.
  const missing = run({}).get('pair-shooter')!;
  assert.equal(missing.checked, false);
  assert.equal(missing.missing.length, 2);
}

// --- Intake arm twist, only while enabled ---
{
  const twist = step(0, 2.5, 3, 4);
  assert.equal(run({ [`${R}/intakeArm/leftMinusRightMotorRot`]: twist }).get('intake-arm-twist')!.alarms.length, 1);
  assert.equal(run({ [`${R}/intakeArm/leftMinusRightMotorRot`]: twist }, { ...gates, enabled: [[10, 20]] }).get('intake-arm-twist')!.alarms.length, 0);
}

// --- Path tracking, in auto, and not from a stale value ---
{
  const errors = (x: Series, y: Series) => ({
    [`${R}/drive/controller/driveWithTrajectory/X Position Error`]: x,
    [`${R}/drive/controller/driveWithTrajectory/Y Position Error`]: y
  });
  assert.equal(run(errors(step(0, 0.3, 1, 2), step(0, 0.3, 1, 2))).get('path-position')!.alarms.length, 1, '0.42 m in auto');
  assert.equal(run(errors(step(0, 0.3, 8, 9), step(0, 0.3, 8, 9))).get('path-position')!.alarms.length, 0, 'not in auto');
  // One sample of a big error, then nothing logged: it doesn't hold.
  assert.equal(run(errors(series([[1, 1]]), series([[1, 1]]))).get('path-position')!.alarms.length, 0);
}

// --- Surfing ---
{
  const wheels = (speeds: (t: number) => number[]) => {
    const out: Record<string, Series> = {};
    for (const m of [0, 1, 2, 3]) {
      const points: [number, number][] = [];
      for (let t = 0; t <= 20; t += 0.02) points.push([t, speeds(t)[m]]);
      out[`${R}/drive/swerve/mod${m}/drive/currentVelMPS`] = series(points);
    }
    return out;
  };
  // Odometry: driving at 2 m/s along x. The fused pose: in the middle of
  // the field (the pile), or `pileX` metres from it.
  const steady = (value: number) => series([[0, value]]);
  const odometry = (prefix: string): Record<string, Series> => {
    const x: [number, number][] = [];
    for (let t = 0; t <= 20; t += 0.2) x.push([t, 2 * t]);
    return { [`${prefix}/translation/x`]: series(x), [`${prefix}/translation/y`]: steady(4), [`${prefix}/rotation/value`]: steady(0) };
  };
  const base = (pitchAt: [number, number], pileX = 0, wheelSpeeds: (t: number) => number[] = () => [2, 2, 2, 2]) => ({
    [`${R}/pigeon/Pitch`]: step(0, 12, ...pitchAt),
    [`${R}/pigeon/Roll`]: step(0, 0, 0, 0),
    [`${R}/drive/estimators/fused/pose/translation/x`]: steady(8 + pileX),
    [`${R}/drive/estimators/fused/pose/translation/y`]: steady(4),
    [`${R}/drive/estimators/fused/pose/rotation/value`]: steady(0),
    ...odometry(`${R}/drive/estimators/odometryOnly/pose`),
    ...wheels(wheelSpeeds)
  });
  // Tilted 12° in the pile 2 s into auto, and a module spinning free: a surf.
  const surf = run(base([2, 2.3], 0, (t) => (t >= 2 && t <= 2.5 ? [2, 2, 4, 2] : [2, 2, 2, 2])));
  assert.equal(surf.get('surf')!.alarms.length, 1);
  assert.match(surf.get('surf')!.alarms[0].title, /Surf \(auto\)/);
  assert.match(surf.get('surf')!.alarms[0].detail, /auto, 2\.0 s in; wheel slip/);
  assert.equal(surf.get('surf-near-miss')!.alarms.length, 0);
  // The same tilt with nothing slipping: a near miss, shown as information.
  const near = run(base([2, 2.3]));
  assert.equal(near.get('surf')!.alarms.length, 0);
  assert.equal(near.get('surf-near-miss')!.alarms.length, 1);
  assert.equal(near.get('surf-near-miss')!.alarms[0].severity, 'info');
  // Tilted in teleop.
  assert.match(run(base([8, 8.3])).get('surf-near-miss')!.alarms[0].title, /teleop/);
  // Out of the pile (crossing something by the wall): neither.
  const away = run(base([2, 2.3], -6));
  assert.equal(away.get('surf')!.alarms.length + away.get('surf-near-miss')!.alarms.length, 0);
  // A tilt too short to count.
  assert.equal(run(base([2, 2.1])).get('surf-near-miss')!.alarms.length, 0);
  assert.equal(monitorSettings.surf.degrees, 8);
}

// --- Vision ---
assert.equal(counterState('data received'), 'valid');
assert.equal(counterState('rejected no tags'), 'noTargets');
assert.equal(counterState('rejected stale heartbeat'), 'noData');
assert.equal(counterState('rejected gyro not level'), 'thrown');
assert.equal(counterState('syncSensors/count'), null);
// A counter that started part way through counts only what it went up by.
const counter = series([[1, 100], [2, 110], [3, 130]]);
assert.equal(counterIncrease(counter, 0, 3), 30);
assert.equal(counterIncrease(counter, 1.5, 2.5), 10);
// Reset (robot code restarted): what it reached since.
assert.equal(counterIncrease(series([[1, 50], [2, 5]]), 1, 2), 5);
assert.equal(visionBins([[10, 70]]).length, 60, 'a second each');
assert.deepEqual(visionBins([[10, 12.5]]), [[10, 11], [11, 12], [12, 12.5]], 'the last one shorter');
{
  const cam = `${R}/drive/providers/llLeft`;
  const log = logOf({
    [`${cam}/perf/data received`]: series([[0, 0], [5, 90], [10, 90]]),
    [`${cam}/perf/rejected gyro not level`]: series([[0, 0], [5, 10], [10, 10]]),
    [`${cam}/perf/rejected no tags`]: series([[0, 0], [10, 200]]),
    [`${cam}/mt2/translation/x`]: series([[1, 5.1], [2, 0]]),
    [`${cam}/mt2/translation/y`]: series([[1, 3], [2, 0]]),
    [`${R}/drive/estimators/fused/pose/translation/x`]: series([[0, 5]]),
    [`${R}/drive/estimators/fused/pose/translation/y`]: series([[0, 3]]),
    [`${R}/drive/estimators/fused/pose/rotation/value`]: series([[0, 0]])
  });
  const summary = visionSummary(log.lookup, log.available, [[0, 10]]);
  assert.equal(summary.cameras.length, 1);
  const left = summary.cameras[0];
  assert.equal(left.name, 'Left');
  assert.deepEqual(left.totals, { valid: 90, thrown: 10, noTargets: 200, noData: 0 });
  assert.equal(left.usedShare, 0.9);
  assert.deepEqual(left.thrownBy, [{ reason: 'gyro not level', count: 10 }]);
  assert.equal(left.bins.length, 10);
  assert.equal(left.bins[4].valid, 90, 'it all came in the fifth second');
  // One real measurement, 0.1 m off; the (0, 0) one is no measurement.
  assert.equal(left.pose.measurements, 1);
  assert.ok(Math.abs(left.pose.maxMeters! - 0.1) < 1e-9);
  // Kept for the charts and the field: the measurement, and the fused pose.
  assert.deepEqual(left.measured, { times: [1], x: [5.1], y: [3], heading: [null], meters: [0.1], degrees: [null] });
  assert.deepEqual(summary.fused, { times: [0], x: [5], y: [3], heading: [0] });
}

// Where on the field: the alliance from where auto started, and zones and
// sides as that alliance's drivers see them.
{
  const track = { times: [0, 10, 20], x: [8, 2, 3], y: [4, 4, 4], heading: [0, 0, 0] };
  assert.equal(allianceFrom(track, 10), 'blue');
  assert.equal(allianceFrom({ ...track, x: [8, 15, 14] }, 10), 'red');
  assert.equal(allianceFrom(undefined, 10), null);
  assert.deepEqual(zoneAt(2, 6, 'blue'), { zone: 'ours', side: 'left' });
  assert.deepEqual(zoneAt(8, 6, 'blue'), { zone: 'neutral', side: 'left' });
  assert.deepEqual(zoneAt(15, 2, 'blue'), { zone: 'theirs', side: 'right' });
  // Red looks the other way: its left is low y.
  assert.deepEqual(zoneAt(15, 2, 'red'), { zone: 'ours', side: 'left' });
  assert.deepEqual(zoneAt(2, 6, 'red'), { zone: 'theirs', side: 'right' });
}
