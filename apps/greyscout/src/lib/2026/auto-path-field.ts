// Field-relative geometry helpers for the 2026 auto path drawer.
//
// Points are stored normalized to [0, 1] in a coordinate frame anchored to
// the path's own alliance/side, and — by construction — that frame is
// alliance-AGNOSTIC:
//   x: 0 = "my" own wall, 1 = the far/opposing wall
//   y: 0 = "my" own left edge, 1 = "my" own right edge
// ("my" meaning whichever alliance is currently asking — the same numbers
// describe the same *kind* of position for either alliance.) Only a SIDE
// change is a real geometric mirror within that frame (see transformPath
// below). Placing these alliance-agnostic coordinates onto one fixed,
// physically point-symmetric field image (red always on the left, blue
// always on the right — see AutoPathCanvas.vue's `toView`/`fromEvent`) is
// a separate concern and is handled entirely by AutoPathCanvas via its
// `display-alliance` prop. Do not also rotate for alliance here — the two
// would cancel out (this is exactly the bug that motivated this comment).

import { allianceRed, allianceBlue, sideLeft, sideRight } from "@/lib/constants";

export interface FieldPoint {
    x: number;
    y: number;
    // Recorded time, [0,1] fraction of the path's normalized duration.
    // Optional — absent on paths saved before per-point timing existed.
    t?: number;
}

export const ALLIANCE_CHOICES = [
    { key: allianceRed, text: "Red" },
    { key: allianceBlue, text: "Blue" }
];

export const SIDE_CHOICES = [
    { key: sideLeft, text: "Left" },
    { key: sideRight, text: "Right" }
];

/**
 * Re-express a path drawn for fromSide as it would look for toSide (left
 * <-> right mirrors across the field's length axis). Alliance plays no
 * part here — see the file header for why.
 */
export function transformPath(points: FieldPoint[], fromSide: string, toSide: string): FieldPoint[] {
    if (fromSide === toSide) {
        return points.map((p) => ({ ...p }));
    }

    return points.map((p) => ({ ...p, y: 1 - p.y }));
}

/**
 * A point's recorded time, in [0,1] fraction of the path's normalized
 * duration. Points saved before per-point timing existed have no `.t` —
 * fall back to even spacing by index so old paths still animate (constant
 * speed) instead of breaking.
 */
export function pointTime(point: FieldPoint, index: number, count: number): number {
    if (typeof point.t === "number") return point.t;
    return count > 1 ? index / (count - 1) : 0;
}

/**
 * Red (t=0, path start) -> violet (t=1, path end) — the rainbow used to
 * color a path by recorded time, shared by the canvas's gradient rendering
 * and the timeline editor so the two always agree on what a given time
 * "looks like".
 */
export function pathTimeColor(t: number): string {
    const hue = Math.min(1, Math.max(0, t)) * 270;
    return `hsl(${hue}, 85%, 50%)`;
}
