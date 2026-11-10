// Comparing autos: where a robot started (alliance and side), and moving its
// path to another alliance or side the way the season's field is symmetric.

import assert from 'node:assert/strict';
import { delayPath, movePose, movesFor, placementOf, poseAt, symmetryFor, trailBefore, type AutoPath } from '@shared/auto-compare';
import type { Pose } from '@shared/plots';

const field = { length: 16.541, width: 8.069 };
const pose = (x: number, y: number, yawDegrees = 0): Pose => {
  const yaw = (yawDegrees * Math.PI) / 180;
  return { x, y, z: 0, qw: Math.cos(yaw / 2), qx: 0, qy: 0, qz: Math.sin(yaw / 2), heading: true };
};
const yawDegrees = (p: Pose) => Math.round((Math.atan2(2 * p.qw * p.qz, 1 - 2 * p.qz * p.qz) * 180) / Math.PI);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

// --- Where it started ---
// Blue's wall is at x = 0 and its drivers look along +x, so their left is +y.
assert.deepEqual(placementOf(pose(3, 6), field), { alliance: 'blue', side: 'left' });
assert.deepEqual(placementOf(pose(3, 2), field), { alliance: 'blue', side: 'right' });
// Red looks the other way: its left is -y.
assert.deepEqual(placementOf(pose(13, 2), field), { alliance: 'red', side: 'left' });
assert.deepEqual(placementOf(pose(13, 6), field), { alliance: 'red', side: 'right' });

assert.equal(symmetryFor('2026'), 'rotate');
assert.equal(symmetryFor('2024'), 'mirror');

// --- Moving it: 2026 turns about the middle ---
{
  const start = pose(3, 6, 30); // blue left
  // As it ran: nothing.
  assert.deepEqual(movesFor(start, field, 'rotate', { alliance: null, side: null }), []);
  assert.deepEqual(movesFor(start, field, 'rotate', { alliance: 'blue', side: 'left' }), []);
  // To red: turned; the drivers' left stays their left.
  const toRed = movesFor(start, field, 'rotate', { alliance: 'red', side: null });
  assert.deepEqual(toRed, ['rotate']);
  const red = movePose(start, toRed, field);
  assert.ok(near(red.x, field.length - 3) && near(red.y, field.width - 6));
  assert.equal(yawDegrees(red), -150, 'facing turned 180°');
  assert.deepEqual(placementOf(red, field), { alliance: 'red', side: 'left' });
  // To red, right: turned, then mirrored across the long axis.
  const redRight = movesFor(start, field, 'rotate', { alliance: 'red', side: 'right' });
  assert.deepEqual(redRight, ['rotate', 'mirror-y']);
  assert.deepEqual(placementOf(movePose(start, redRight, field), field), { alliance: 'red', side: 'right' });
  // Its own alliance, the other side: only mirrored.
  const blueRight = movesFor(start, field, 'rotate', { alliance: null, side: 'right' });
  assert.deepEqual(blueRight, ['mirror-y']);
  const mirrored = movePose(start, blueRight, field);
  assert.ok(near(mirrored.y, field.width - 6));
  assert.equal(yawDegrees(mirrored), -30, 'heading mirrored');
}

// --- A mirrored season: crossing over swaps the side too ---
{
  const start = pose(3, 6, 30); // blue left
  const toRed = movesFor(start, field, 'mirror', { alliance: 'red', side: null });
  assert.deepEqual(toRed, ['mirror-x']);
  const red = movePose(start, toRed, field);
  assert.equal(yawDegrees(red), 150);
  assert.deepEqual(placementOf(red, field), { alliance: 'red', side: 'right' });
  // Kept on the drivers' left: mirrored both ways.
  assert.deepEqual(movesFor(start, field, 'mirror', { alliance: 'red', side: 'left' }), ['mirror-x', 'mirror-y']);
}

// --- Along the path in time ---
{
  const path: AutoPath = { times: [0, 1, 2, 3], poses: [pose(1, 1), pose(2, 1), pose(3, 1), pose(4, 1)] };
  assert.equal(poseAt(path, 1.5)!.x, 2);
  assert.equal(poseAt(path, -1)!.x, 1, 'before its first: where it began');
  assert.equal(poseAt(path, 9)!.x, 4, 'after its last: where it ended');
  assert.equal(poseAt({ times: [], poses: [] }, 1), null);
  assert.deepEqual(trailBefore(path, 2.5, 1.5).map((p) => p.x), [2, 3]);
}

// --- Started later: waiting where it began ---
{
  const path: AutoPath = { times: [0, 1, 2], poses: [pose(1, 1), pose(2, 1), pose(3, 1)] };
  const late = delayPath(path, 2.5);
  assert.deepEqual(late.times, [2.5, 3.5, 4.5]);
  assert.equal(poseAt(late, 1)!.x, 1, 'still at the start');
  assert.equal(poseAt(late, 3.6)!.x, 2);
  assert.equal(delayPath(path, 0), path);
  assert.equal(delayPath(path, -3), path, 'no earlier than auto');
  assert.equal(delayPath(path, NaN), path);
}

console.log('auto-compare: ok');
