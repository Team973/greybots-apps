// Symmetry sections: two signals that should match (a mechanism's left and
// right motors, or what it was told against what it did), compared over a
// report's spans, each value held until the next.

import assert from 'node:assert/strict';
import { compareSymmetry, spansWhereText } from '@shared/symmetry';

const series = (points: [number, number][]) => ({ times: points.map((p) => p[0]), values: points.map((p) => p[1]) });
const close = (actual: number | null, expected: number, message?: string) =>
  assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${message ?? ''}: ${actual} isn't ${expected}`);

// A held 10 throughout; B 10, then 6 from t = 5: apart by 4 for half the time.
{
  const a = series([[0, 10]]);
  const b = series([[0, 10], [5, 6]]);
  const r = compareSymmetry(a, b, [[0, 10]], { activeAbove: null, magnitude: false });
  close(r.seconds, 10, 'seconds');
  close(r.meanA, 10, 'mean A');
  close(r.meanB, 8, 'mean B');
  close(r.meanGap, 2, 'A − B');
  close(r.meanAbsGap, 2, 'apart on average');
  close(r.maxAbsGap, 4, 'apart at most');
  close(r.maxAt, 5, 'when');
}

// Only within the spans, with the value held into each from before it.
{
  const a = series([[0, 1], [20, 3]]);
  const b = series([[0, 1]]);
  const r = compareSymmetry(a, b, [[10, 15], [25, 30]], { activeAbove: null, magnitude: false });
  close(r.seconds, 10);
  close(r.meanAbsGap, 1, 'apart only in the second span');
  close(r.maxAt, 25);
}

// Motors running opposite ways: by size they're alike; by sign they aren't.
{
  const a = series([[0, 20]]);
  const b = series([[0, -20]]);
  close(compareSymmetry(a, b, [[0, 4]], { activeAbove: null, magnitude: true }).maxAbsGap, 0, 'by size');
  close(compareSymmetry(a, b, [[0, 4]], { activeAbove: null, magnitude: false }).maxAbsGap, 40, 'by sign');
}

// Only while running: a pair sitting at 0 A isn't counted as alike.
{
  const a = series([[0, 0], [2, 30], [4, 0]]);
  const b = series([[0, 0], [2, 20], [4, 0]]);
  const r = compareSymmetry(a, b, [[0, 10]], { activeAbove: 5, magnitude: true });
  close(r.seconds, 2, 'only the 2 s running');
  close(r.meanAbsGap, 10);
  // Never running: nothing compared.
  const idle = compareSymmetry(series([[0, 1]]), series([[0, 2]]), [[0, 10]], { activeAbove: 5, magnitude: true });
  assert.equal(idle.seconds, 0);
  assert.equal(idle.meanA, null);
}

// Before either has a value there's nothing to compare.
{
  const r = compareSymmetry(series([[5, 1]]), series([[0, 1]]), [[0, 10]], { activeAbove: null, magnitude: false });
  close(r.seconds, 5);
}

// Only while a state holds: the flywheel's target is worked out even while
// it's off, so it's only held to it in ClosedLoop.
{
  const state = { times: [0, 10, 20, 30], values: ['Off', 'ClosedLoop', 'Off', 'ClosedLoop'] };
  assert.deepEqual(spansWhereText(state, 'ClosedLoop', [[5, 35]]), [[10, 20], [30, 35]]);
  assert.deepEqual(spansWhereText(state, 'ClosedLoop', [[12, 15]]), [[12, 15]], 'held into the span');
  assert.deepEqual(spansWhereText(state, 'Manual', [[0, 40]]), []);
  const target = series([[0, 15]]);
  const actual = series([[0, 0], [10, 15], [20, 0]]);
  const within = spansWhereText(state, 'ClosedLoop', [[0, 25]]);
  const r = compareSymmetry(target, actual, within, { activeAbove: null, magnitude: false });
  close(r.seconds, 10);
  close(r.maxAbsGap, 0, 'on target whenever it was asked to be');
}

console.log('symmetry: ok');
