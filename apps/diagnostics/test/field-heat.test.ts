// Field heatmaps as point clouds: a point for each sample where the robot
// was, piled up into fine, blurred bins to draw.

import assert from 'node:assert/strict';
import { binShares, binTop, fieldHeat, heatDensity, heatTotal } from '@shared/field-heat';

// Two seconds at (1.2, 1.2), then two at (3.1, 1.2), a pose every half second.
const pose = {
  times: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
  x: [1.2, 1.2, 1.2, 1.2, 3.1, 3.1, 3.1, 3.1],
  y: [1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2]
};
// The weight at each place.
const at = (heat: ReturnType<typeof fieldHeat>) => {
  const out: Record<string, number> = {};
  for (const p of heat.points) out[`${p.x},${p.y}`] = (out[`${p.x},${p.y}`] ?? 0) + p.w;
  return out;
};

// Time: a point a pose, weighted by how long until the next (the last has
// none, so isn't there).
const time = fieldHeat(pose, null, 'time');
assert.deepEqual(at(time), { '1.2,1.2': 2, '3.1,1.2': 1.5 });
assert.equal(time.points.length, 7);
// Only within the spans.
assert.deepEqual(at(fieldHeat(pose, null, 'time', [[2, 4]])), { '3.1,1.2': 1.5 });

// A signal: a point a sample, with its value.
const current = { times: [0.2, 0.7, 2.2, 2.7], values: [10, 20, 40, 40] };
const mean = fieldHeat(pose, current, 'mean');
assert.deepEqual(mean.points, [
  { x: 1.2, y: 1.2, w: 1, v: 10 }, { x: 1.2, y: 1.2, w: 1, v: 20 }, { x: 3.1, y: 1.2, w: 1, v: 40 }, { x: 3.1, y: 1.2, w: 1, v: 40 }
]);
assert.deepEqual(heatTotal(mean), { points: 4, total: 4, low: 10, high: 40 });

// A counter's rises; a reset (it went down) counts from 0.
const counter = { times: [0.2, 0.7, 2.2, 2.7, 3.2], values: [100, 130, 140, 5, 25] };
assert.deepEqual(at(fieldHeat(pose, counter, 'increase')), { '1.2,1.2': 30, '3.1,1.2': 10 + 5 + 20 });

// No pose (0, 0), or none recent: not counted. A longer freshness can.
const lost = { times: [0, 5], x: [0, 2], y: [0, 2] };
assert.deepEqual(fieldHeat(lost, { times: [0.1, 4], values: [1, 2] }, 'mean').points, []);
assert.equal(fieldHeat({ times: [0], x: [2], y: [2] }, { times: [0, 4], values: [1, 2] }, 'increase', undefined, 5).points.length, 1);

// Drawn: each point spread over the bins around it, so its own bin is the
// heaviest and they fade out; two points close together pile up.
const one = heatDensity({ measure: 'increase', points: [{ x: 1.05, y: 1.05, w: 1 }] }, 0.1, 2);
const centre = one.find((b) => b.col === 10 && b.row === 10)!;
assert.equal(centre.weight, 1);
assert.ok(one.every((b) => b.weight <= 1));
assert.equal(one.length, 13, 'a circle two bins out');
const two = heatDensity({ measure: 'increase', points: [{ x: 1.05, y: 1.05, w: 1 }, { x: 1.15, y: 1.05, w: 1 }] }, 0.1, 2);
assert.ok(binTop(two) > 1, 'they pile up between');

// Shares: the heaviest is 1; on a shared scale, less.
assert.equal(Math.max(...binShares(one, 'increase').map((b) => b.share)), 1);
assert.ok(Math.max(...binShares(one, 'increase', 4).map((b) => b.share)) < 1);
// Averages: low values faint, high ones strong.
const avg = heatDensity({ measure: 'mean', points: [{ x: 0.05, y: 0.05, w: 1, v: 10 }, { x: 2.05, y: 0.05, w: 1, v: 30 }] }, 0.1, 1);
const shares = binShares(avg, 'mean');
assert.equal(shares.find((b) => b.col === 0 && b.row === 0)!.share, 0);
assert.equal(shares.find((b) => b.col === 20 && b.row === 0)!.share, 1);
