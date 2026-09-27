<script setup lang="ts">
// @ts-nocheck
</script>

<template>
    <div class="autopath-timeline" :class="{ 'autopath-timeline--disabled': disabled }">
        <div class="timeline-track" ref="track" @pointerdown="onTrackPointerDown" @pointermove="onTrackPointerMove"
            @pointerup="onTrackPointerUp" @pointercancel="onTrackPointerUp" @dblclick="onTrackDoubleClick">
            <!-- Each region spans exactly one draggable-bound-to-draggable-bound
                 stretch — its left/width ARE the bounds' real-time positions
                 (so width = seconds), but its color is fixed by point order
                 (rank), the same fixed rainbow the canvas draws the path in
                 above. So "red for 4 seconds" always means the same (red)
                 stretch of the drawn path, just currently allotted 4 seconds
                 of the auto; dragging a bound changes how many seconds each
                 of its two neighboring regions get, never which color either
                 region is. Regions tile the bar completely (no gaps), so a
                 double-click anywhere lands inside exactly one and splits it. -->
            <span v-for="region in regions" :key="region.key"
                :style="{ left: `${region.left}%`, width: `${region.width}%`, background: region.background }"
                class="timeline-region"></span>
            <div class="timeline-scrub" :style="{ left: `${scrubProgress * 100}%` }"></div>
            <!-- Draggable bounds sit at the border between two regions and
                 resize both — a wide invisible hit area around a slim visible
                 line, since a thin strip is much easier to land a drag on
                 than a small floating dot was. Only interior bounds render;
                 the two ends are the bar's own edges and aren't interactive. -->
            <div v-for="(bound, idx) in interiorBounds" :key="bound.pointIndex" class="timeline-bound"
                :style="{ left: `${bound.t * 100}%` }" @pointerdown="onBoundPointerDown(bound.handleIdx, $event)"
                @pointermove="onBoundPointerMove(bound.handleIdx, $event)"
                @pointerup="onBoundPointerUp(bound.handleIdx, $event)"
                @pointercancel="onBoundPointerUp(bound.handleIdx, $event)"
                @dblclick="onBoundDoubleClick(bound.handleIdx, $event)">
                <span class="timeline-bound-line"></span>
            </div>
        </div>
        <div class="timeline-ticks">
            <span v-for="tick in tickSeconds" :key="tick.s" class="timeline-tick"
                :class="{ 'timeline-tick--minor': !tick.major }" :style="{ left: `${(tick.s * 1000 / duration) * 100}%` }">
                {{ tick.major ? `${tick.s}s` : '' }}
            </span>
        </div>
        <p class="timeline-hint" v-if="!disabled">Drag the border between two colors to shrink or stretch
            them — the far left and right edges are fixed so the whole auto still fits in
            {{ Math.round(duration / 1000) }} seconds. Each color always marks the same stretch of the
            drawn path (see the field above); dragging only changes how many seconds each stretch takes.
            Double-click a color to split it into two, or double-click a border to remove it and merge
            its two sides back together. Drag anywhere else on the bar to preview the robot's position
            at that time.</p>
        <p class="timeline-hint" v-else>Timing edits are paused while the path is playing — the white bar
            tracks playback. Press stop to edit again.</p>
    </div>
</template>

<script lang="ts">
import { pointTime, pathTimeColor } from "@/lib/2026/auto-path-field";

// How many regions the path starts out divided into. Exposing every raw
// drawn point (there can be hundreds) as its own region would be an
// unusable wall of slivers, so this is just the *initial* split — the scout
// can split or merge regions from there (see onTrackDoubleClick/onBoundDoubleClick).
const INITIAL_REGIONS = 10;

// Rescales points[startIdx..endIdx]'s recorded time from the old
// [oldStart, oldEnd] range into the new [newStart, newEnd] range, in place.
function rescaleRange(points, startIdx, endIdx, oldStart, oldEnd, newStart, newEnd) {
    const oldSpan = oldEnd - oldStart;
    for (let i = startIdx; i <= endIdx; i++) {
        const frac = oldSpan === 0 ? 0 : (points[i].t - oldStart) / oldSpan;
        points[i].t = newStart + frac * (newEnd - newStart);
    }
}

export default {
    props: {
        // Points in the same {x, y, t} shape as AutoPathCanvas.
        points: {
            type: Array,
            default: () => []
        },
        duration: {
            type: Number,
            default: 20000
        },
        // Scrub position (0..1) — parent owns this so it can feed it
        // straight into AutoPathCanvas's `previewProgress`.
        scrubProgress: {
            type: Number,
            default: 0
        },
        // While true (the path is playing), bound dragging/split/merge and
        // manual scrubbing are ignored — editing timing while the canvas is
        // actively animating the same points out from under the edit was
        // the source of the "glitchy, stuck" feeling; the parent instead
        // drives `scrubProgress` itself from the canvas's own playback
        // progress, so the white bar still tracks along in real time.
        disabled: {
            type: Boolean,
            default: false
        }
    },
    emits: ["update:points", "update:scrubProgress"],
    data() {
        return {
            draggingHandleIdx: null,
            isScrubbing: false,
            // Point-array indices marking region boundaries. Always includes
            // 0 and points.length-1 (the fixed start/end anchors) — every
            // interior boundary is user-editable via double-click split/merge.
            handleIndices: []
        };
    },
    computed: {
        // Every boundary (including the two fixed ends), positioned by its
        // point's own recorded time. Used both to build `regions` and to
        // drive drag math — `interiorBounds` below is the subset actually
        // rendered as a draggable divider.
        handles() {
            const len = this.points.length;
            return this.handleIndices.map((pointIndex) => ({
                pointIndex,
                t: pointTime(this.points[pointIndex], pointIndex, len),
                fixed: pointIndex === 0 || pointIndex === len - 1
            }));
        },
        // The draggable dividers — every boundary except the bar's own two
        // outer edges, which have nothing to drag (there's no region beyond
        // them). Keeps each entry's index into the full `handles` array
        // (`handleIdx`) so drag handlers can look up prev/cur/next directly.
        interiorBounds() {
            return this.handles
                .map((handle, handleIdx) => ({ ...handle, handleIdx }))
                .filter((handle) => !handle.fixed);
        },
        // One colored, real-time-widthed box per region between consecutive
        // boundaries — see the template comment for what left/width/color mean.
        regions() {
            const len = this.points.length;
            const handles = this.handles;
            if (handles.length < 2) return [];

            // Each region is a gradient across its own rank span, not one
            // flat midpoint color — a flat color only matches the canvas at
            // the region's exact middle, drifting further off at the edges
            // the wider the region is. Multiple stops (not just the two
            // endpoints) because CSS gradients interpolate RGB linearly
            // between stops, which drifts from pathTimeColor's HSL-based hue
            // sweep over a wide span; several stops keep each inter-stop hop
            // small enough that the difference is invisible. Adjacent
            // regions share a boundary stop's exact color, so they meet with
            // no visible seam.
            const STOPS_PER_REGION = 4;
            const regions = [];
            for (let i = 1; i < handles.length; i++) {
                const prev = handles[i - 1];
                const cur = handles[i];
                const stops = [];
                for (let s = 0; s <= STOPS_PER_REGION; s++) {
                    const pointIndex = prev.pointIndex + (cur.pointIndex - prev.pointIndex) * (s / STOPS_PER_REGION);
                    const rank = len > 1 ? pointIndex / (len - 1) : 0;
                    stops.push(pathTimeColor(rank));
                }
                regions.push({
                    key: `${prev.pointIndex}-${cur.pointIndex}`,
                    left: prev.t * 100,
                    width: Math.max((cur.t - prev.t) * 100, 0),
                    background: `linear-gradient(to right, ${stops.join(", ")})`
                });
            }
            return regions;
        },
        // One tick per second (1-second resolution), with every 5th one
        // labeled — labeling all of them would overlap.
        tickSeconds() {
            const totalSeconds = Math.round(this.duration / 1000);
            const ticks = [];
            for (let s = 0; s <= totalSeconds; s += 1) ticks.push({ s, major: s % 5 === 0 });
            return ticks;
        }
    },
    watch: {
        // Re-seed the evenly-spaced default set whenever the point count
        // changes. Points only ever change by appending (still drawing) or
        // resetting to empty — never by inserting/reordering — so trying to
        // remap old indices onto the new length is unnecessary work that,
        // worse, compounds rounding error into collapsed/duplicate boundaries
        // over the many small growth steps a single stroke fires. A custom
        // split/merge only "sticks" once the scout has stopped drawing and
        // the length stops changing — matching the normal
        // draw-first-then-adjust-timing workflow.
        "points.length"() {
            this.seedHandleIndices();
        },
        // Cleanly bail out of any in-progress drag/scrub the instant playback
        // starts, rather than leaving a stale pointer-captured drag hanging.
        disabled(isDisabled) {
            if (isDisabled) {
                this.draggingHandleIdx = null;
                this.isScrubbing = false;
            }
        }
    },
    created() {
        this.seedHandleIndices();
    },
    methods: {
        seedHandleIndices() {
            const len = this.points.length;
            if (len < 2) {
                this.handleIndices = [];
                return;
            }
            const regions = Math.min(INITIAL_REGIONS, len - 1);
            const indices = new Set();
            for (let k = 0; k <= regions; k++) {
                indices.add(Math.round((k / regions) * (len - 1)));
            }
            this.handleIndices = [...indices].sort((a, b) => a - b);
        },
        tFromClientX(clientX) {
            const rect = this.$refs.track.getBoundingClientRect();
            const frac = rect.width === 0 ? 0 : (clientX - rect.left) / rect.width;
            return Math.min(1, Math.max(0, frac));
        },
        // Splits whichever region the double-click landed in by adding a
        // new boundary at the point nearest the clicked time.
        onTrackDoubleClick(event) {
            if (this.disabled || this.points.length < 2) return;
            const target = this.tFromClientX(event.clientX);

            let nearestIdx = 0;
            let nearestDist = Infinity;
            this.points.forEach((p, i) => {
                const dist = Math.abs(pointTime(p, i, this.points.length) - target);
                if (dist < nearestDist) {
                    nearestDist = dist;
                    nearestIdx = i;
                }
            });

            if (this.handleIndices.includes(nearestIdx)) return;
            this.handleIndices = [...this.handleIndices, nearestIdx].sort((a, b) => a - b);
        },
        // Removes a boundary the scout previously added (or one of the
        // initial ones), merging the two regions on either side back into
        // one — the two fixed end anchors can't be removed.
        onBoundDoubleClick(handleIdx, event) {
            event.stopPropagation();
            if (this.disabled) return;
            const handle = this.handles[handleIdx];
            if (!handle || handle.fixed) return;
            this.handleIndices = this.handleIndices.filter((idx) => idx !== handle.pointIndex);
        },
        onBoundPointerDown(handleIdx, event) {
            if (this.disabled || this.handles[handleIdx].fixed) return;
            event.stopPropagation();
            event.preventDefault();
            event.target.setPointerCapture?.(event.pointerId);
            this.draggingHandleIdx = handleIdx;
        },
        onBoundPointerMove(handleIdx, event) {
            if (this.draggingHandleIdx !== handleIdx) return;
            event.stopPropagation();
            this.dragHandleTo(handleIdx, this.tFromClientX(event.clientX));
        },
        onBoundPointerUp(handleIdx, event) {
            if (this.draggingHandleIdx !== handleIdx) return;
            event.stopPropagation();
            event.target.releasePointerCapture?.(event.pointerId);
            this.draggingHandleIdx = null;
        },
        dragHandleTo(handleIdx, rawT) {
            const handles = this.handles;
            const prev = handles[handleIdx - 1];
            const next = handles[handleIdx + 1];
            const cur = handles[handleIdx];
            if (!prev || !next) return;

            // Keeps every region at least this wide (as a fraction of the
            // total duration, ~500ms) so requestAnimationFrame — which only
            // samples animProgress every ~16ms — always gets several frames
            // to render while playback passes through it. A region allowed
            // to shrink arbitrarily thin (the old EPS = 0.001, ~20ms) could
            // get only one or two rendered frames total, which reads as the
            // marker teleporting rather than moving smoothly.
            const MIN_REGION_T = 0.025;
            // Guard against prev/next themselves already being closer
            // together than 2*MIN_REGION_T (possible via double-click
            // splits, which don't enforce this minimum) — clamping against
            // both bounds normally in that case would let the lower bound
            // win and push newT past prev.t, inverting the range.
            const available = next.t - prev.t;
            const newT = available <= MIN_REGION_T * 2
                ? prev.t + available / 2
                : Math.min(next.t - MIN_REGION_T, Math.max(prev.t + MIN_REGION_T, rawT));

            const points = this.points.map((p, i) => ({ ...p, t: pointTime(p, i, this.points.length) }));
            // The two ranges share cur.pointIndex as their common edge. The
            // first call sets it to exactly newT; the second call must NOT
            // also touch it — if it did, it would read that already-updated
            // value back as its own "old" reference instead of the true
            // original cur.t, scrambling both the boundary point's own
            // saved time and every point after it (this was the actual bug
            // behind saved timing not matching what was dragged to).
            rescaleRange(points, prev.pointIndex, cur.pointIndex, prev.t, cur.t, prev.t, newT);
            rescaleRange(points, cur.pointIndex + 1, next.pointIndex, cur.t, next.t, newT, next.t);

            this.$emit("update:points", points);
        },
        onTrackPointerDown(event) {
            if (this.disabled || this.draggingHandleIdx !== null) return;
            event.target.setPointerCapture?.(event.pointerId);
            this.isScrubbing = true;
            this.$emit("update:scrubProgress", this.tFromClientX(event.clientX));
        },
        onTrackPointerMove(event) {
            if (!this.isScrubbing) return;
            this.$emit("update:scrubProgress", this.tFromClientX(event.clientX));
        },
        onTrackPointerUp(event) {
            event.target.releasePointerCapture?.(event.pointerId);
            this.isScrubbing = false;
        }
    }
};
</script>

<style scoped>
.autopath-timeline {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.timeline-track {
    position: relative;
    height: 28px;
    touch-action: none;
    cursor: pointer;
    border-radius: 6px;
    overflow: hidden;
}

.autopath-timeline--disabled .timeline-track {
    cursor: default;
}

.autopath-timeline--disabled .timeline-bound {
    cursor: default;
    opacity: 0.4;
}

.timeline-region {
    position: absolute;
    top: 0;
    bottom: 0;
    opacity: 0.9;
    pointer-events: none;
}

.timeline-scrub {
    position: absolute;
    top: -3px;
    bottom: -3px;
    width: 2px;
    background: var(--primary-text-color);
    transform: translateX(-50%);
    pointer-events: none;
}

/* A wide invisible hit area centered on the boundary, with a slim visible
   line in the middle — much easier to land a drag on than a small dot. */
.timeline-bound {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    transform: translateX(-50%);
    cursor: ew-resize;
    touch-action: none;
}

.timeline-bound-line {
    width: 3px;
    height: 100%;
    background: var(--primary-text-color);
    border-radius: 2px;
    opacity: 0.85;
    pointer-events: none;
}

.timeline-bound:hover .timeline-bound-line {
    opacity: 1;
    width: 4px;
}

.timeline-ticks {
    position: relative;
    height: 14px;
}

.timeline-tick {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    font-size: 10px;
    opacity: 0.6;
    white-space: nowrap;
}

.timeline-tick--minor {
    top: 1px;
    width: 1px;
    height: 5px;
    background: var(--primary-text-color);
    opacity: 0.35;
}

.timeline-hint {
    font-size: 0.85em;
    opacity: 0.75;
    margin: 4px 0 0;
}
</style>
