// Field heatmaps: squares of the field, by time spent, a signal's average,
// or a counter's rise.

import assert from 'node:assert/strict';
import { fieldHeat, heatPeak, heatShares } from '@shared/field-heat';

// Two seconds at (1.2, 1.2), then two at (3.1, 1.2), a pose every half second.
const pose = {
  times: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
  x: [1.2, 1.2, 1.2, 1.2, 3.1, 3.1, 3.1, 3.1],
  y: [1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2]
};
const byCell = (heat: ReturnType<typeof fieldHeat>) => Object.fromEntries(heat.cells.map((c) => [`${c.col},${c.row}`, c.value]));

// Time: two seconds in the first square, one and a half in the second (its
// last pose has no next to last until).
assert.deepEqual(byCell(fieldHeat(pose, null, 'time')), { '2,2': 2, '6,2': 1.5 });
// Squares a metre across.
assert.deepEqual(byCell(fieldHeat(pose, null, 'time', 1)), { '1,1': 2, '3,1': 1.5 });
// Only within the spans.
assert.deepEqual(byCell(fieldHeat(pose, null, 'time', 0.5, [[2, 4]])), { '6,2': 1.5 });

// A signal's average while there.
const current = { times: [0.2, 0.7, 2.2, 2.7], values: [10, 20, 40, 40] };
assert.deepEqual(byCell(fieldHeat(pose, current, 'mean')), { '2,2': 15, '6,2': 40 });

// A counter's rise while there; a reset (it went down) counts from 0.
const counter = { times: [0.2, 0.7, 2.2, 2.7, 3.2], values: [100, 130, 140, 5, 25] };
assert.deepEqual(byCell(fieldHeat(pose, counter, 'increase')), { '2,2': 30, '6,2': 10 + 5 + 20 });

// No pose (0, 0), or none recent: not counted.
const lost = { times: [0, 5], x: [0, 2], y: [0, 2] };
assert.deepEqual(fieldHeat(lost, { times: [0.1, 4], values: [1, 2] }, 'mean').cells, []);

// Shares: of the strongest, from 0 (or from the weakest, for averages);
// or on a scale shared with others.
const time = fieldHeat(pose, null, 'time');
assert.deepEqual(heatShares(time).map((c) => c.share), [1, 0.75]);
assert.deepEqual(heatShares(time, 4).map((c) => c.share), [0.5, 0.375]);
assert.deepEqual(heatShares(fieldHeat(pose, current, 'mean')).map((c) => c.share), [0, 1]);
assert.equal(heatPeak(time), 2);
assert.equal(heatPeak(fieldHeat({ times: [], x: [], y: [] }, null, 'time')), null);
