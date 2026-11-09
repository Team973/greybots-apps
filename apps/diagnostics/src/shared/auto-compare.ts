// Comparing autos: several robots' autonomous paths on one field, each
// moved to the alliance and side of the field it's to be tried from, so an
// alliance partner's auto, or an opponent's, can be laid beside ours.
//
// Where a robot started says which alliance it ran on (the half of the
// field it was in) and which side (left or right, as its drivers see it
// from their wall). Moving it to the other alliance turns or mirrors it
// the way the season's field is symmetric (Choreo's flipper for the year:
// 2026's REBUILT turns 180° about the middle); moving it to the other side
// mirrors it across the field's long axis.
//
// Nothing here may touch Node or the DOM.

import type { Pose } from './plots';

export type Alliance = 'red' | 'blue';
export type FieldSide = 'left' | 'right';

// How the field's two halves match: turned 180° about the middle, or
// mirrored across the line between the alliances.
export type FieldSymmetry = 'rotate' | 'mirror';

// By season, as Choreo flips paths for the year (ChoreoAllianceFlipUtil's
// FRC_CURRENT): 2022 Rapid React, 2025 Reefscape and 2026 Rebuilt are
// turned; 2023 Charged Up and 2024 Crescendo mirrored.
export const fieldSymmetry: Record<string, FieldSymmetry> = {
  '2026': 'rotate',
  '2025': 'rotate',
  '2024': 'mirror',
  '2023': 'mirror',
  '2022': 'rotate'
};
export const symmetryFor = (season: string): FieldSymmetry => fieldSymmetry[season] ?? 'rotate';

export interface FieldSize {
  // Metres, along the field (x) and across it (y).
  length: number;
  width: number;
}

export interface Placement {
  alliance: Alliance;
  side: FieldSide;
}

// Where a pose is: the alliance whose half it's in (blue's wall at x = 0),
// and its side as that alliance's drivers see it (blue looks along +x, so
// its left is +y; red looks the other way).
export function placementOf(pose: Pick<Pose, 'x' | 'y'>, field: FieldSize): Placement {
  const alliance: Alliance = pose.x < field.length / 2 ? 'blue' : 'red';
  const upper = pose.y > field.width / 2;
  return { alliance, side: (alliance === 'blue') === upper ? 'left' : 'right' };
}

// One step of moving a path: turning it about the field's middle, or
// mirroring it across the middle line (x) or the long axis (y).
export type Move = 'rotate' | 'mirror-x' | 'mirror-y';

// What it takes to bring a path that started at `start` to the alliance
// and side wanted (each, or null to keep it as it ran).
export function movesFor(start: Pick<Pose, 'x' | 'y'>, field: FieldSize, symmetry: FieldSymmetry,
  want: { alliance: Alliance | null; side: FieldSide | null }): Move[] {
  const moves: Move[] = [];
  let at = { x: start.x, y: start.y };
  if (want.alliance && placementOf(at, field).alliance !== want.alliance) {
    const move: Move = symmetry === 'rotate' ? 'rotate' : 'mirror-x';
    moves.push(move);
    at = movePoint(at, move, field);
  }
  // Turning keeps the side as the drivers see it; mirroring swaps it.
  if (want.side && placementOf(at, field).side !== want.side) moves.push('mirror-y');
  return moves;
}

function movePoint(p: { x: number; y: number }, move: Move, field: FieldSize): { x: number; y: number } {
  switch (move) {
    case 'rotate':
      return { x: field.length - p.x, y: field.width - p.y };
    case 'mirror-x':
      return { x: field.length - p.x, y: p.y };
    case 'mirror-y':
      return { x: p.x, y: field.width - p.y };
  }
}

const yawOf = (p: Pose) => Math.atan2(2 * (p.qw * p.qz + p.qx * p.qy), 1 - 2 * (p.qy * p.qy + p.qz * p.qz));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// A pose moved: its place, and which way it faces (turned with the field,
// or mirrored). Only its heading on the field is kept, not pitch or roll.
export function movePose(pose: Pose, moves: Move[], field: FieldSize): Pose {
  let { x, y } = pose;
  let yaw = yawOf(pose);
  for (const move of moves) {
    ({ x, y } = movePoint({ x, y }, move, field));
    yaw = move === 'rotate' ? yaw + Math.PI : move === 'mirror-x' ? Math.PI - yaw : -yaw;
  }
  yaw = wrap(yaw);
  return { ...pose, x, y, qw: Math.cos(yaw / 2), qx: 0, qy: 0, qz: Math.sin(yaw / 2) };
}

// A path in time: seconds since its auto started, and where it was.
export interface AutoPath {
  times: number[];
  poses: Pose[];
}

// Where it was `t` seconds into its auto: the last pose at or before, or
// the first before it had one, or null with none.
export function poseAt(path: AutoPath, t: number): Pose | null {
  if (path.poses.length === 0) return null;
  let low = 0;
  let high = path.times.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (path.times[mid] <= t) low = mid + 1;
    else high = mid;
  }
  return path.poses[Math.max(0, low - 1)];
}

// The poses over the `seconds` before `t`, for a trail behind the robot.
export function trailBefore(path: AutoPath, t: number, seconds: number): Pose[] {
  const out: Pose[] = [];
  for (let i = 0; i < path.times.length && path.times[i] <= t; i++) if (path.times[i] >= t - seconds) out.push(path.poses[i]);
  return out;
}

const allianceNames: Record<Alliance, string> = { red: 'Red', blue: 'Blue' };
const sideNames: Record<FieldSide, string> = { left: 'left', right: 'right' };
export const describePlacement = (p: Placement) => `${allianceNames[p.alliance]} ${sideNames[p.side]}`;
