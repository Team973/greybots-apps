<script setup lang="ts">
// @ts-nocheck
import fieldImage from "@/assets/2026-field.png";
</script>

<template>
    <div class="autopath-canvas" :class="{ 'autopath-canvas--editable': editable, 'autopath-canvas--large': large }">
        <svg :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`" preserveAspectRatio="xMidYMid meet" ref="svg"
            @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp"
            @pointercancel="onPointerUp" @pointerleave="onPointerUp">
            <!-- 2026 field overlay (fixed orientation: red alliance wall on the image's
                 left, blue on the right). Paths are rotated 180 degrees into this frame
                 when displayAlliance is blue, since the field is point-symmetric. -->
            <image :href="fieldImage" x="0" y="0" :width="VIEW_W" :height="VIEW_H" preserveAspectRatio="none"></image>

            <!-- Multi-path overlay mode (read-only context: Match Preview / Strategy Preview
                 and Auto Edit's background). Each layer carries its own alliance so red and
                 blue can render together on one canvas. -->
            <template v-if="hasLayers">
                <g v-for="layer in layers" :key="layer.key">
                    <polyline v-if="layer.points.length > 1" :points="pointsToPolyline(layer.points, layer.alliance)"
                        class="path-line" :style="{ stroke: layer.color }"></polyline>
                    <circle v-if="layer.points.length > 0" v-bind="toView(layer.points[0], layer.alliance)" r="3.5"
                        class="path-start" :style="{ fill: layer.color }"></circle>
                </g>
                <template v-for="m in animatedLayerMarkers" :key="`robot-${m.key}`">
                    <clipPath v-if="m.photoUrl" :id="`${markerClipId}-${m.key}`">
                        <rect :x="m.marker.cx - MARKER_PHOTO_SIZE / 2" :y="m.marker.cy - MARKER_PHOTO_SIZE / 2"
                            :width="MARKER_PHOTO_SIZE" :height="MARKER_PHOTO_SIZE"></rect>
                    </clipPath>
                    <image v-if="m.photoUrl" :href="m.photoUrl" :x="m.marker.cx - MARKER_PHOTO_SIZE / 2"
                        :y="m.marker.cy - MARKER_PHOTO_SIZE / 2" :width="MARKER_PHOTO_SIZE" :height="MARKER_PHOTO_SIZE"
                        preserveAspectRatio="xMidYMid slice" :clip-path="`url(#${markerClipId}-${m.key})`"
                        class="path-robot-photo"></image>
                    <circle v-else v-bind="m.marker" r="6" class="path-robot" :style="{ fill: m.color }"></circle>
                </template>
            </template>

            <!-- Single editable/viewable path (editor / per-path card view / Auto Edit's
                 in-place new path). Renders whenever there's no layers overlay at all, OR
                 (alongside the layers above) while actively editable — Auto Edit draws a new
                 path in the context of the existing read-only layers. -->
            <template v-if="editable || !hasLayers">
                <template v-if="timeGradient && gradientSegments.length > 0">
                    <line v-for="(seg, idx) in gradientSegments" :key="idx" :x1="seg.x1" :y1="seg.y1" :x2="seg.x2"
                        :y2="seg.y2" class="path-line" :style="{ stroke: seg.color }"></line>
                </template>
                <polyline v-else-if="displayPoints.length > 1" :points="pointsToPolyline(displayPoints)"
                    class="path-line" :style="{ stroke: color }"></polyline>
                <circle v-if="displayPoints.length > 0" v-bind="toView(displayPoints[0])" r="3.5" class="path-start"
                    :style="{ fill: timeGradient ? pathTimeColor(0) : color }"></circle>
                <!-- The rainbow gradient already shows start (red) vs end
                     (violet) at a glance; the flat single-color viewer
                     (cards, not the editor) has no such cue, so it gets an
                     end marker and text labels instead. -->
                <template v-if="!timeGradient">
                    <circle v-if="displayPoints.length > 1" v-bind="toView(displayPoints[displayPoints.length - 1])"
                        r="3.5" class="path-end" :style="{ fill: color }"></circle>
                    <text v-if="displayPoints.length > 0" v-bind="labelPos(displayPoints[0])" class="path-label">Start</text>
                    <text v-if="displayPoints.length > 1" v-bind="labelPos(displayPoints[displayPoints.length - 1])" class="path-label">End</text>
                </template>
                <template v-if="animatedMarker">
                    <clipPath v-if="robotPhotoUrl" :id="markerClipId">
                        <rect :x="animatedMarker.cx - MARKER_PHOTO_SIZE / 2" :y="animatedMarker.cy - MARKER_PHOTO_SIZE / 2"
                            :width="MARKER_PHOTO_SIZE" :height="MARKER_PHOTO_SIZE"></rect>
                    </clipPath>
                    <image v-if="robotPhotoUrl" :href="robotPhotoUrl" :x="animatedMarker.cx - MARKER_PHOTO_SIZE / 2"
                        :y="animatedMarker.cy - MARKER_PHOTO_SIZE / 2" :width="MARKER_PHOTO_SIZE" :height="MARKER_PHOTO_SIZE"
                        preserveAspectRatio="xMidYMid slice" :clip-path="`url(#${markerClipId})`"
                        class="path-robot-photo"></image>
                    <circle v-else v-bind="animatedMarker" r="6" class="path-robot"
                        :style="{ fill: timeGradient ? pathTimeColor(markerColorFraction) : color }"></circle>
                </template>
            </template>

            <g v-if="editable && displayPoints.length === 0">
                <rect :x="VIEW_W / 2 - 62" :y="VIEW_H / 2 - 8" width="124" height="16" rx="4" class="empty-hint-bg">
                </rect>
                <text :x="VIEW_W / 2" :y="VIEW_H / 2" class="empty-hint">Draw the auto path here</text>
            </g>

            <!-- Big team-number/name labels next to the field art's printed
                 R1/R2/R3 and B1/B2/B3 driver-station markings, so it's
                 obvious at a glance which team is standing where. Only shown
                 when the caller (Strategy Preview) hands us assignments.
                 Drawn last (on top of paths/markers) since a path's start
                 point sits right where these labels do. -->
            <template v-for="label in stationLabelViews" :key="`station-${label.slot}`">
                <text :x="label.cx" :y="label.cy" :text-anchor="label.anchor" class="station-label"
                    :style="{ fill: label.color }">{{ label.text }}</text>
            </template>
        </svg>
    </div>
</template>

<script lang="ts">
import { allianceRed, allianceBlue } from "@/lib/constants";
import { pointTime, pathTimeColor } from "@/lib/2026/auto-path-field";

// Intrinsic aspect ratio of 2026-field.png (7992x3240), scaled down for a tidy viewBox.
const VIEW_W = 740;
const VIEW_H = 300;

// The playing-field boundary (the black rectangle) as a fraction of the FULL
// image, measured directly from the source PNG (src/assets/2026-field.png is
// 7992x3240; the field rect spans x:[1048,6943] y:[171,3068] in that image).
// The image also depicts off-field content (numbered starting zones, human
// player stations) outside this rectangle, so path coordinates only ever
// map into this sub-region, not the full canvas.
const FIELD_BOUNDS = { left: 0.13113, right: 0.86874, top: 0.05278, bottom: 0.94691 };

// Robot photo marker's square side length, in the same view-space units as
// VIEW_W/VIEW_H. 0.8x of the original 3x-enlarged size (48) per issue #32
// follow-up feedback.
const MARKER_PHOTO_SIZE = 38;

// Vertical position (fraction of the FULL field image, top to bottom) of
// the field art's printed "1"/"2"/"3" driver-station row for a red-side
// slot, measured directly from src/assets/2026-field.png. Blue's rows sit
// at the point-symmetric mirror of these (1 - y) — same 180-degree
// point-symmetry the rest of this file already relies on (see toView) —
// which is also why Red N and Blue N end up diagonally opposite each
// other rather than side-by-side.
const STATION_ROW_Y = [0.1628, 0.3637, 0.6966];

// Where each of the 6 alliance slots' driver-station label anchors, in FULL
// image fraction coordinates (not the FIELD_BOUNDS sub-rectangle path
// points use) — these sit just OUTSIDE the playing field's own edge (red to
// its left, blue to its right), in the margin where the field art's
// driver-station markings already are, never over the playing surface.
function stationPosition(slot) {
    const isRed = slot < 3;
    const row = slot % 3;
    return {
        x: isRed ? FIELD_BOUNDS.left : FIELD_BOUNDS.right,
        y: isRed ? STATION_ROW_Y[row] : 1 - STATION_ROW_Y[row],
        // Anchored away from the field: red text ends at the field edge and
        // grows further left (into the margin); blue starts at the field
        // edge and grows further right — so neither ever renders over the
        // field itself.
        anchor: isRed ? 'end' : 'start'
    };
}

// Position along a polyline of already-view-space {cx, cy} points at time
// fraction `t` (0..1), using each point's own recorded time rather than
// constant speed by arc length — this is what makes playback "time
// relative": a stretch of points recorded close together in time (the scout
// drew that part of the path quickly) plays back quickly, and a stretch
// recorded far apart in time (drawn slowly, e.g. a scoring action) plays
// back slowly, regardless of how much on-field distance either covers.
function markerAtTime(points, viewPoints, t) {
    if (viewPoints.length < 2) return viewPoints[0] ?? null;

    const times = points.map((p, i) => pointTime(p, i, points.length));
    const clamped = Math.min(1, Math.max(0, t));

    if (clamped <= times[0]) return viewPoints[0];
    if (clamped >= times[times.length - 1]) return viewPoints[viewPoints.length - 1];

    for (let i = 1; i < times.length; i++) {
        if (clamped <= times[i]) {
            const span = times[i] - times[i - 1];
            const segT = span === 0 ? 0 : (clamped - times[i - 1]) / span;
            return {
                cx: viewPoints[i - 1].cx + (viewPoints[i].cx - viewPoints[i - 1].cx) * segT,
                cy: viewPoints[i - 1].cy + (viewPoints[i].cy - viewPoints[i - 1].cy) * segT
            };
        }
    }
    return viewPoints[viewPoints.length - 1];
}

// The fractional RANK (0..1 by point order, never by recorded time) that
// time `t` currently falls at, given each point's own recorded time. This
// is the inverse of "where in time is rank R" — used so the animated
// marker's color always matches whichever fixed-rank-colored segment
// (see gradientSegments below) it's currently passing through, even though
// the time-to-rank mapping is exactly what timing edits change.
function rankAtTime(points, t) {
    const n = points.length;
    if (n < 2) return 0;

    const times = points.map((p, i) => pointTime(p, i, n));
    const clamped = Math.min(1, Math.max(0, t));

    if (clamped <= times[0]) return 0;
    if (clamped >= times[n - 1]) return 1;

    for (let i = 1; i < times.length; i++) {
        if (clamped <= times[i]) {
            const span = times[i] - times[i - 1];
            const segT = span === 0 ? 0 : (clamped - times[i - 1]) / span;
            const rankBefore = (i - 1) / (n - 1);
            const rankAfter = i / (n - 1);
            return rankBefore + (rankAfter - rankBefore) * segT;
        }
    }
    return 1;
}

export default {
    props: {
        // Points in the [0,1] frame already resolved for the alliance/side being displayed.
        // Each point is { x, y, t } — t is the point's own recorded time,
        // in [0,1] fraction of the path's normalized duration (see pointTime in auto-path-field.ts).
        points: {
            type: Array,
            default: () => []
        },
        displayAlliance: {
            type: String,
            default: allianceRed
        },
        editable: {
            type: Boolean,
            default: false
        },
        color: {
            type: String,
            default: "#ff8c00"
        },
        // Renders the path as a rainbow gradient (red = start, violet = end)
        // colored by fixed point order, instead of a flat `color` — used by
        // the editor. Colored by order rather than recorded time so editing
        // timing on the timeline below never repaints the path; the
        // timeline shows how many seconds each fixed color takes instead.
        timeGradient: {
            type: Boolean,
            default: false
        },
        // Optional multi-path overlay: [{ key, points, color }]. When set,
        // this takes over rendering instead of the single `points`/`color` props.
        layers: {
            type: Array,
            default: () => []
        },
        // Widens the canvas well past the default small/list-thumbnail size —
        // meant for the full-page editor, where desktop has room to spare and
        // a bigger drawing surface makes precise drawing much easier.
        large: {
            type: Boolean,
            default: false
        },
        // When true, animates a robot marker traveling along the path(s),
        // reaching the end after `duration` ms regardless of path length or
        // point count — but at each point's own recorded pace in between
        // (time-relative, see markerAtTime above). Parent owns this flag
        // (play/stop button) and should reset it to false on the `finished` event.
        playing: {
            type: Boolean,
            default: false
        },
        duration: {
            type: Number,
            default: 20000
        },
        // Optional static "scrub" position (0..1): shows the marker at this
        // time without running the play animation, for the timeline editor's
        // scrub handle. Takes precedence over the play animation's progress.
        previewProgress: {
            type: Number,
            default: null
        },
        // Robot photo URL for the single-path marker (parent fetches via
        // fetchRobotPhotoUrl — this component stays Supabase-free). Falls
        // back to the flat-color circle when absent (team has no synced
        // photo). Multi-path layers carry their own optional `photoUrl`.
        robotPhotoUrl: {
            type: String,
            default: null
        },
        // Optional [{ slot: 0-5, text, color }] — big team labels drawn next
        // to the field art's printed driver-station markings. slot follows
        // the same 0-2 red / 3-5 blue convention as everywhere else (see
        // STATION_POSITIONS below for the physical position each maps to).
        stationLabels: {
            type: Array,
            default: () => []
        }
    },
    emits: ["update:points", "finished", "progress"],
    data() {
        return {
            VIEW_W,
            VIEW_H,
            MARKER_PHOTO_SIZE,
            isDrawing: false,
            // Unique per component instance so multiple canvases on one page
            // (e.g. several AutoPathCards) don't collide on SVG clipPath ids,
            // which are global to the document.
            markerClipId: `robot-clip-${Math.random().toString(36).slice(2)}`,
            animProgress: 0,
            animStartTime: null,
            animFrame: null,
            // Recording state for per-point timing while drawing (see
            // pushPoint/resyncTimestamps below). Parallel array to
            // displayPoints, holding each point's elapsed *active* drawing
            // time in ms — paused while the pointer is lifted between
            // strokes, since a lift is just a recording pause (see
            // docs/auto-paths.md's "continuous-path drawing"), not something
            // the robot actually did.
            drawTimestamps: [],
            accumulatedMs: 0,
            strokeAnchorTime: null
        };
    },
    computed: {
        hasLayers() {
            return this.layers.length > 0;
        },
        stationLabelViews() {
            // ~25 view-space units (this file already treats those 1:1 with
            // screen px elsewhere, e.g. MARKER_PHOTO_SIZE/ERASE_RADIUS) past
            // the field's own edge, so the label sits clear of the alliance
            // wall instead of right up against it.
            const PADDING = 25;
            return this.stationLabels.map((label) => {
                const pos = stationPosition(label.slot);
                return {
                    slot: label.slot,
                    text: label.text,
                    color: label.color,
                    anchor: pos.anchor,
                    cx: pos.x * VIEW_W + (pos.anchor === 'start' ? PADDING : -PADDING),
                    cy: pos.y * VIEW_H
                };
            });
        },
        displayPoints() {
            return this.points ?? [];
        },
        effectiveProgress() {
            return this.previewProgress !== null ? this.previewProgress : this.animProgress;
        },
        showMarker() {
            return this.playing || this.animProgress > 0 || this.previewProgress !== null;
        },
        animatedMarker() {
            if (this.hasLayers || !this.showMarker) return null;
            if (this.displayPoints.length < 2) return null;
            return markerAtTime(this.displayPoints, this.displayPoints.map((p) => this.toView(p)), this.effectiveProgress);
        },
        animatedLayerMarkers() {
            if (!this.hasLayers || this.animProgress === 0 && !this.playing) return [];
            return this.layers
                .filter((layer) => layer.points.length >= 2)
                .map((layer) => {
                    // A delayed layer stays parked at its start point until
                    // its own delay fraction of the animation has elapsed,
                    // then plays out its remaining path compressed into the
                    // remaining time — a visualization-only approximation
                    // (duration itself doesn't extend for delayed layers).
                    const layerT = layer.delayFraction > 0
                        ? Math.max(0, (this.animProgress - layer.delayFraction) / Math.max(0.0001, 1 - layer.delayFraction))
                        : this.animProgress;
                    return {
                        key: layer.key,
                        color: layer.color,
                        photoUrl: layer.photoUrl ?? null,
                        marker: markerAtTime(layer.points, layer.points.map((p) => this.toView(p, layer.alliance)), layerT)
                    };
                });
        },
        // Colored by fixed RANK (point order), never by recorded time — so
        // editing timing on the timeline never repaints the path: "the red
        // part of the path" always means the same stretch of drawing. Only
        // how many seconds that fixed-colored stretch takes (shown on the
        // timeline, see AutoPathTimeline.vue) is editable.
        gradientSegments() {
            if (!this.timeGradient || this.displayPoints.length < 2) return [];
            const view = this.displayPoints.map((p) => this.toView(p));
            const len = this.displayPoints.length;

            const segments = [];
            for (let i = 1; i < len; i++) {
                segments.push({
                    x1: view[i - 1].cx,
                    y1: view[i - 1].cy,
                    x2: view[i].cx,
                    y2: view[i].cy,
                    color: pathTimeColor(((i - 1) / (len - 1) + i / (len - 1)) / 2)
                });
            }
            return segments;
        },
        // The marker's color follows whichever fixed-rank-colored segment
        // it's currently passing through in time, via rankAtTime — not the
        // raw time progress, which would drift out of sync with the path's
        // (fixed) coloring as soon as timing is edited to be non-uniform.
        markerColorFraction() {
            if (this.hasLayers || this.displayPoints.length < 2) return 0;
            return rankAtTime(this.displayPoints, this.effectiveProgress);
        }
    },
    watch: {
        playing(newVal) {
            if (newVal) {
                this.startAnimation();
            } else {
                this.stopAnimation();
            }
        }
    },
    beforeUnmount() {
        this.stopAnimation();
    },
    methods: {
        // Own-relative [0,1] point -> pixel position in the full field image,
        // rotating 180 degrees first when displaying for blue (see field-image
        // comment above). Accepts an optional per-call alliance override so
        // multi-path layers mode can place red and blue layers together on
        // one canvas without a canvas-wide displayAlliance prop — this stays
        // the one place alliance-based rotation happens either way.
        toView(p, alliance = this.displayAlliance) {
            let x = p.x;
            let y = p.y;
            if (alliance === allianceBlue) {
                x = 1 - x;
                y = 1 - y;
            }
            const fx = FIELD_BOUNDS.left + x * (FIELD_BOUNDS.right - FIELD_BOUNDS.left);
            const fy = FIELD_BOUNDS.top + y * (FIELD_BOUNDS.bottom - FIELD_BOUNDS.top);
            return { cx: fx * VIEW_W, cy: fy * VIEW_H };
        },
        pointsToPolyline(points, alliance = this.displayAlliance) {
            return points.map((p) => {
                const { cx, cy } = this.toView(p, alliance);
                return `${cx},${cy}`;
            }).join(" ");
        },
        // Small fixed offset from a start/end marker so the label text
        // doesn't sit directly on top of the dot.
        labelPos(p) {
            const { cx, cy } = this.toView(p);
            return { x: cx + 6, y: cy - 6 };
        },
        fromEvent(event) {
            const svg = this.$refs.svg;
            const rect = svg.getBoundingClientRect();
            const relX = (event.clientX - rect.left) / rect.width;
            const relY = (event.clientY - rect.top) / rect.height;

            // Un-letterbox from full-image fraction into the playing-field sub-rectangle.
            let fx = (relX - FIELD_BOUNDS.left) / (FIELD_BOUNDS.right - FIELD_BOUNDS.left);
            let fy = (relY - FIELD_BOUNDS.top) / (FIELD_BOUNDS.bottom - FIELD_BOUNDS.top);
            fx = Math.min(1, Math.max(0, fx));
            fy = Math.min(1, Math.max(0, fy));

            if (this.displayAlliance === allianceBlue) {
                fx = 1 - fx;
                fy = 1 - fy;
            }

            return { x: fx, y: fy };
        },
        // Re-syncs drawTimestamps with displayPoints whenever they've
        // diverged — e.g. the parent reset the path (points -> []), or
        // loaded an existing saved path (points -> its stored {x,y,t}s) —
        // so a resumed/continued stroke keeps counting from a sensible
        // elapsed time instead of a stale one. Existing points' timing is
        // reconstructed from their stored `t` (scaled by `duration`, purely
        // as an internal bookkeeping unit — everything gets re-normalized
        // to [0,1] on the next point anyway).
        resyncTimestamps() {
            if (this.drawTimestamps.length !== this.displayPoints.length) {
                this.drawTimestamps = this.displayPoints.map((p, i) => pointTime(p, i, this.displayPoints.length) * this.duration);
            }
            this.accumulatedMs = this.drawTimestamps.length > 0 ? this.drawTimestamps[this.drawTimestamps.length - 1] : 0;
        },
        // Appends one freshly-drawn raw {x,y} point, records its elapsed
        // active-drawing time, and emits the whole path re-normalized so
        // every point's `t` is a [0,1] fraction of the total drawing time so far.
        pushPoint(rawPoint) {
            const elapsed = this.strokeAnchorTime !== null
                ? this.accumulatedMs + (performance.now() - this.strokeAnchorTime)
                : this.accumulatedMs;
            this.drawTimestamps = [...this.drawTimestamps, elapsed];

            const maxMs = this.drawTimestamps[this.drawTimestamps.length - 1] || 0;
            const newPoints = [...this.displayPoints.map((p) => ({ x: p.x, y: p.y })), rawPoint];
            this.$emit("update:points", newPoints.map((p, i) => ({
                x: p.x,
                y: p.y,
                t: maxMs > 0 ? this.drawTimestamps[i] / maxMs : (i === 0 ? 0 : 1)
            })));
        },
        onPointerDown(event) {
            if (!this.editable) return;
            event.preventDefault();
            this.isDrawing = true;
            this.$refs.svg.setPointerCapture?.(event.pointerId);
            this.resyncTimestamps();
            this.strokeAnchorTime = performance.now();
            this.pushPoint(this.fromEvent(event));
        },
        onPointerMove(event) {
            if (!this.editable || !this.isDrawing) return;
            event.preventDefault();
            this.pushPoint(this.fromEvent(event));
        },
        onPointerUp() {
            // Deliberately does NOT clear the point buffer: lifting the pointer
            // just pauses a stroke. Any further drawing appends to the same
            // point array so the saved/rendered path is one continuous line
            // even if the scout's real-world drawing wasn't (see issue #14).
            this.isDrawing = false;
            if (this.strokeAnchorTime !== null) {
                this.accumulatedMs += performance.now() - this.strokeAnchorTime;
                this.strokeAnchorTime = null;
            }
        },
        startAnimation() {
            this.animProgress = 0;
            this.animStartTime = null;

            const step = (timestamp) => {
                if (!this.playing) return;
                if (this.animStartTime === null) this.animStartTime = timestamp;

                const elapsed = timestamp - this.animStartTime;
                this.animProgress = Math.min(1, elapsed / this.duration);
                this.$emit("progress", this.animProgress);

                if (this.animProgress < 1) {
                    this.animFrame = requestAnimationFrame(step);
                } else {
                    this.animFrame = null;
                    this.$emit("finished");
                }
            };
            this.animFrame = requestAnimationFrame(step);
        },
        // Deliberately does NOT reset animProgress: the marker should stay
        // parked wherever playback left it (its final position when a path
        // finishes naturally, or wherever it was when manually stopped)
        // instead of snapping back to the start. startAnimation() is the
        // only place that resets progress to 0, for a fresh play-through.
        stopAnimation() {
            if (this.animFrame !== null) cancelAnimationFrame(this.animFrame);
            this.animFrame = null;
        }
    }
};
</script>

<style scoped>
.autopath-canvas {
    position: relative;
    width: 100%;
    max-width: 480px;
}

.autopath-canvas--large {
    max-width: none;
}

.autopath-canvas svg {
    width: 100%;
    height: auto;
    background: var(--tile-background-color, #fff);
    border-radius: 8px;
    touch-action: none;
    -webkit-user-select: none;
    user-select: none;
}

.autopath-canvas--editable svg {
    cursor: crosshair;
}

.path-line {
    fill: none;
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.path-start {
    stroke: none;
}

.path-end {
    stroke: none;
    opacity: 0.6;
}

.station-label {
    font-size: 18px;
    font-weight: 700;
    dominant-baseline: middle;
}

.path-label {
    font-size: 9px;
    font-weight: 600;
    fill: var(--primary-text-color, #fff);
    stroke: var(--tile-background-color, #000);
    stroke-width: 2px;
    paint-order: stroke fill;
}

.path-robot {
    stroke: #fff;
    stroke-width: 1.5;
}

.path-robot-photo {
    stroke: #fff;
}

.empty-hint-bg {
    fill: var(--tile-background-color, #fff);
    opacity: 0.85;
}

.empty-hint {
    font-size: 9px;
    fill: var(--primary-text-color, #3c3c3c);
    text-anchor: middle;
    dominant-baseline: middle;
}
</style>
