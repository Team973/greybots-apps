<script setup lang="ts">
// @ts-nocheck
import fieldImage from "@/assets/2026-field.png";
</script>

<template>
    <div class="strategy-canvas">
        <svg :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`" preserveAspectRatio="xMidYMid meet" ref="svg"
            :class="{ 'strategy-canvas-svg--erase': tool === 'erase' }" @pointerdown="onPointerDown"
            @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp"
            @pointerleave="onPointerUp">
            <!-- Strategy board coordinates are always drawn directly onto this
                 real fixed-orientation field (red-left, blue-right) — unlike
                 AutoPath, there's no per-team own-relative reframing to undo,
                 since a board isn't reused across alliances/sides. -->
            <image :href="fieldImage" x="0" y="0" :width="VIEW_W" :height="VIEW_H" preserveAspectRatio="none"></image>

            <g v-for="entry in board" :key="entry.slot">
                <template v-for="(stroke, idx) in entry.strokes" :key="idx">
                    <polyline v-if="stroke.length > 1" :points="pointsToPolyline(stroke)" class="board-stroke"
                        :style="{ stroke: slotColor(entry.slot) }"></polyline>
                    <circle v-else-if="stroke.length === 1" v-bind="toView(stroke[0])" r="3" class="board-dot"
                        :style="{ fill: slotColor(entry.slot) }"></circle>
                </template>
            </g>
        </svg>
    </div>
</template>

<script lang="ts">
// Same intrinsic geometry as AutoPathCanvas.vue (shared field art), kept as
// its own small copy rather than importing from there — the two components'
// data models and drawing semantics are different enough (non-continuous
// multi-stroke per team vs. one continuous timed path) that sharing code
// would fight AutoPathCanvas's continuous-path architecture more than it'd save.
const VIEW_W = 740;
const VIEW_H = 300;
const FIELD_BOUNDS = { left: 0.13113, right: 0.86874, top: 0.05278, bottom: 0.94691 };
// Hit-test radius for the eraser tool, in the same view-space units as
// VIEW_W/VIEW_H — generous enough to catch a stroke without requiring
// pixel-perfect aim on a touch device.
const ERASE_RADIUS = 12;

export default {
    props: {
        // [{ slot, strokes: [{x,y}][] }] — non-continuous: each stroke is its
        // own disconnected polyline, unlike AutoPath's single merged path.
        board: {
            type: Array,
            default: () => []
        },
        activeSlot: {
            type: Number,
            default: 0
        },
        slotColor: {
            type: Function,
            required: true
        },
        // 'draw' appends to the active slot's strokes as before; 'erase'
        // instead removes whichever whole strokes (from any slot) the
        // pointer passes over.
        tool: {
            type: String,
            default: 'draw'
        }
    },
    emits: ["update:board", "stroke-start"],
    data() {
        return {
            VIEW_W,
            VIEW_H,
            isDrawing: false
        };
    },
    methods: {
        toView(p) {
            const fx = FIELD_BOUNDS.left + p.x * (FIELD_BOUNDS.right - FIELD_BOUNDS.left);
            const fy = FIELD_BOUNDS.top + p.y * (FIELD_BOUNDS.bottom - FIELD_BOUNDS.top);
            return { cx: fx * VIEW_W, cy: fy * VIEW_H };
        },
        pointsToPolyline(points) {
            return points.map((p) => {
                const { cx, cy } = this.toView(p);
                return `${cx},${cy}`;
            }).join(" ");
        },
        fromEvent(event) {
            const svg = this.$refs.svg;
            const rect = svg.getBoundingClientRect();
            const relX = (event.clientX - rect.left) / rect.width;
            const relY = (event.clientY - rect.top) / rect.height;

            let fx = (relX - FIELD_BOUNDS.left) / (FIELD_BOUNDS.right - FIELD_BOUNDS.left);
            let fy = (relY - FIELD_BOUNDS.top) / (FIELD_BOUNDS.bottom - FIELD_BOUNDS.top);
            fx = Math.min(1, Math.max(0, fx));
            fy = Math.min(1, Math.max(0, fy));

            return { x: fx, y: fy };
        },
        // Appends a point to the active slot's board entry — a new stroke
        // when startNewStroke is true (pointer just went down), otherwise
        // extending the current stroke in progress. This is the literal
        // inverse of AutoPathCanvas.onPointerUp's "never clear the buffer"
        // behavior: here, lifting the pointer really does end a stroke.
        pushPoint(rawPoint, startNewStroke) {
            const board = this.board.map((entry) => ({ ...entry, strokes: entry.strokes.map((s) => [...s]) }));
            let entry = board.find((e) => e.slot === this.activeSlot);
            if (!entry) {
                entry = { slot: this.activeSlot, strokes: [] };
                board.push(entry);
            }

            if (startNewStroke || entry.strokes.length === 0) {
                entry.strokes.push([rawPoint]);
            } else {
                entry.strokes[entry.strokes.length - 1].push(rawPoint);
            }

            this.$emit("update:board", board);
        },
        // Removes every whole stroke (from any slot, not just activeSlot —
        // the eraser is a shared whiteboard tool for tidying up the board,
        // not a per-team action) that passes within ERASE_RADIUS of
        // rawPoint. Whole-stroke removal rather than partial/pixel erasing
        // keeps the hit-testing simple: a stroke is either touched or not.
        eraseAt(rawPoint) {
            const target = this.toView(rawPoint);
            let changed = false;

            const board = this.board
                .map((entry) => ({
                    ...entry,
                    strokes: entry.strokes.filter((stroke) => {
                        const hit = stroke.some((p) => {
                            const v = this.toView(p);
                            const dx = v.cx - target.cx;
                            const dy = v.cy - target.cy;
                            return dx * dx + dy * dy <= ERASE_RADIUS * ERASE_RADIUS;
                        });
                        if (hit) changed = true;
                        return !hit;
                    })
                }))
                .filter((entry) => entry.strokes.length > 0);

            if (changed) this.$emit("update:board", board);
        },
        onPointerDown(event) {
            event.preventDefault();
            this.isDrawing = true;
            this.$refs.svg.setPointerCapture?.(event.pointerId);
            // Emitted before the first mutation of this drag so the parent
            // can snapshot the board for undo — one snapshot per drag,
            // whether it ends up drawing one stroke or erasing several.
            this.$emit("stroke-start");
            if (this.tool === 'erase') {
                this.eraseAt(this.fromEvent(event));
            } else {
                this.pushPoint(this.fromEvent(event), true);
            }
        },
        onPointerMove(event) {
            if (!this.isDrawing) return;
            event.preventDefault();
            if (this.tool === 'erase') {
                this.eraseAt(this.fromEvent(event));
            } else {
                this.pushPoint(this.fromEvent(event), false);
            }
        },
        onPointerUp() {
            this.isDrawing = false;
        }
    }
};
</script>

<style scoped>
.strategy-canvas {
    width: 100%;
}

.strategy-canvas svg {
    width: 100%;
    height: auto;
    background: var(--tile-background-color, #fff);
    border-radius: 8px;
    touch-action: none;
    -webkit-user-select: none;
    user-select: none;
    cursor: crosshair;
}

.strategy-canvas svg.strategy-canvas-svg--erase {
    cursor: cell;
}

.board-stroke {
    fill: none;
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.board-dot {
    stroke: none;
}
</style>
