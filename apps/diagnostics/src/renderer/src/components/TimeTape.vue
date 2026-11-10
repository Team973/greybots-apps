<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';

import { phaseClock, tapeDoubleClickView, tapeLabels, tapeSegments, tapeZoomChoices, type ClockMode, type MatchPhase, type TapeKind, type TapeZoom } from '@shared/events';

// The playback tape, in two parts, both coloured by what the robot was
// doing (disabled, auto, teleop, endgame):
// - the overview, a thin strip of the whole log with the span shown as a
//   window: drag the window to move it, its edges to widen or narrow it,
//   or click elsewhere on the strip to move it there;
// - the tape, a strip of film of the span shown, zoomed as it is: click or
//   drag to move the moment shown; scroll to zoom, Shift+scroll to pan,
//   double-click to fit the phase or stretch there (again for everything),
//   right-click for a menu of those, the match and everything.
// The span is the line chart's: zooming either zooms both, and every tab
// (the line chart, the field, the 3D robot, the console) shows the moment.

const props = defineProps<{
  full: [number, number];
  view: [number, number];
  // The moment shown, or null when nothing's pinned.
  time: number | null;
  phases: MatchPhase[];
  enabled: [number, number][];
  // How times in a phase read (a report's choice); left out, elapsed with no word.
  clockMode?: ClockMode;
}>();

export type TapeGesture = 'wheel' | 'pan' | 'select' | 'all';
const emit = defineEmits<{
  seek: [time: number];
  zoom: [view: [number, number], gesture: TapeGesture];
}>();

const tapeColors: Record<TapeKind, string> = {
  disabled: '#6b7079',
  enabled: '#2a78d6',
  auto: '#c98500',
  teleop: '#2e9e5b',
  endgame: '#1d6e43'
};
// The narrowest span shown, seconds (or the whole log, if shorter).
const minSpan = 0.5;

const fullLength = computed(() => Math.max(1e-9, props.full[1] - props.full[0]));
const viewLength = computed(() => Math.max(1e-9, props.view[1] - props.view[0]));
// Where a time is, as a share of the whole log (overview) or of the span (tape).
const ofFull = (t: number) => Math.min(1, Math.max(0, (t - props.full[0]) / fullLength.value));
const ofView = (t: number) => (t - props.view[0]) / viewLength.value;
const pct = (share: number) => `${share * 100}%`;

const allSegments = computed(() => tapeSegments(props.full, props.phases, props.enabled));
const overviewSegments = computed(() => allSegments.value.map((s) => ({
  ...s,
  left: pct(ofFull(s.start)),
  width: pct(ofFull(s.end) - ofFull(s.start))
})));
// The tape's: those in the span shown, cut to it.
const tapeSegmentsShown = computed(() => allSegments.value
  .filter((s) => s.end > props.view[0] && s.start < props.view[1])
  .map((s) => {
    const start = Math.max(s.start, props.view[0]);
    const end = Math.min(s.end, props.view[1]);
    return {
      ...s,
      left: pct(ofView(start)),
      width: pct(ofView(end) - ofView(start)),
      label: tapeLabels[s.kind],
      title: `${tapeLabels[s.kind]}: ${s.start.toFixed(1)}–${s.end.toFixed(1)} s (${(s.end - s.start).toFixed(1)} s)`
    };
  }));

const clamp = (view: [number, number]): [number, number] => {
  const [lo, hi] = props.full;
  const span = Math.min(hi - lo, Math.max(Math.min(minSpan, hi - lo), view[1] - view[0]));
  const start = Math.min(hi - span, Math.max(lo, view[0]));
  return [start, start + span];
};
const showsAll = computed(() => props.view[0] <= props.full[0] + 1e-6 && props.view[1] >= props.full[1] - 1e-6);

// --- The tape: picking the moment, zooming ---

const tape = ref<HTMLElement | null>(null);
const tapeTime = (clientX: number) => {
  const box = tape.value!.getBoundingClientRect();
  return props.view[0] + Math.min(1, Math.max(0, (clientX - box.left) / box.width)) * viewLength.value;
};
const dragging = ref(false);
const hover = ref<{ t: number; left: string } | null>(null);
function onDown(event: PointerEvent) {
  if (event.button !== 0) return;
  dragging.value = true;
  tape.value!.setPointerCapture(event.pointerId);
  emit('seek', tapeTime(event.clientX));
}
function onMove(event: PointerEvent) {
  const t = tapeTime(event.clientX);
  hover.value = { t, left: pct(ofView(t)) };
  if (dragging.value) emit('seek', t);
}
function onUp(event: PointerEvent) {
  dragging.value = false;
  tape.value?.releasePointerCapture(event.pointerId);
}
// Scroll zooms about the pointer, as on the line chart; Shift+scroll (or a
// sideways scroll) pans.
function onWheel(event: WheelEvent) {
  const sideways = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY);
  const box = tape.value!.getBoundingClientRect();
  if (sideways) {
    const raw = event.shiftKey ? event.deltaY || event.deltaX : event.deltaX;
    const delta = event.deltaMode === 1 ? raw * 16 : raw;
    const move = (delta / box.width) * viewLength.value;
    emit('zoom', clamp([props.view[0] + move, props.view[1] + move]), 'pan');
    return;
  }
  // As the line chart zooms: by how far it scrolled, not a step per event
  // (a trackpad sends many small ones). Lines, from a mouse wheel, as pixels.
  const at = tapeTime(event.clientX);
  const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
  const factor = Math.pow(1.0015, delta);
  emit('zoom', clamp([at - (at - props.view[0]) * factor, at + (props.view[1] - at) * factor]), 'wheel');
}
const showAll = () => emit('zoom', [props.full[0], props.full[1]], 'all');
// A span to fit: everything is 'all', as the Show all button; anything
// else a chosen span.
function fit(view: [number, number]) {
  if (view[0] <= props.full[0] && view[1] >= props.full[1]) showAll();
  else emit('zoom', clamp(view), 'select');
}
const onDoubleClick = (event: MouseEvent) =>
  fit(tapeDoubleClickView(props.full, props.phases, props.enabled, props.view, tapeTime(event.clientX)));

// Right-click: fit the phase (or stretch) there, the match, or everything.
const zoomMenu = ref<{ x: number; y: number; choices: TapeZoom[] } | null>(null);
function openZoomMenu(event: MouseEvent) {
  event.preventDefault();
  const choices = tapeZoomChoices(props.full, props.phases, props.enabled, tapeTime(event.clientX));
  // Kept inside the window: each choice is about 30 px tall.
  zoomMenu.value = {
    x: Math.min(event.clientX, window.innerWidth - 220),
    y: Math.min(event.clientY, window.innerHeight - 12 - choices.length * 32),
    choices
  };
}
const closeZoomMenu = () => (zoomMenu.value = null);
function chooseZoom(choice: TapeZoom) {
  closeZoomMenu();
  fit(choice.view);
}
const onMenuKey = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && zoomMenu.value) closeZoomMenu();
};
window.addEventListener('keydown', onMenuKey);
onUnmounted(() => window.removeEventListener('keydown', onMenuKey));

// The arrow keys step a tenth of a second (Shift: a second); Home and End;
// + and - zoom about the moment.
function onKey(event: KeyboardEvent) {
  const now = props.time ?? props.view[0];
  if (event.key === '+' || event.key === '=' || event.key === '-') {
    event.preventDefault();
    const factor = event.key === '-' ? 1.5 : 1 / 1.5;
    emit('zoom', clamp([now - (now - props.view[0]) * factor, now + (props.view[1] - now) * factor]), 'wheel');
    return;
  }
  const step = event.shiftKey ? 1 : 0.1;
  const to = event.key === 'ArrowLeft' ? now - step : event.key === 'ArrowRight' ? now + step
    : event.key === 'Home' ? props.full[0] : event.key === 'End' ? props.full[1] : null;
  if (to === null) return;
  event.preventDefault();
  emit('seek', Math.min(props.full[1], Math.max(props.full[0], to)));
}

// --- The overview: moving and sizing the window ---

const overview = ref<HTMLElement | null>(null);
const overviewTime = (clientX: number) => {
  const box = overview.value!.getBoundingClientRect();
  return props.full[0] + Math.min(1, Math.max(0, (clientX - box.left) / box.width)) * fullLength.value;
};
let windowDrag: { mode: 'move' | 'start' | 'end'; grab: number } | null = null;
function onOverviewDown(event: PointerEvent, mode: 'move' | 'start' | 'end' | 'jump') {
  if (event.button !== 0) return;
  event.stopPropagation();
  const t = overviewTime(event.clientX);
  if (mode === 'jump') {
    // Centred where clicked, then dragged from there.
    const half = viewLength.value / 2;
    emit('zoom', clamp([t - half, t + half]), 'pan');
    windowDrag = { mode: 'move', grab: half };
  } else windowDrag = { mode, grab: t - props.view[0] };
  overview.value!.setPointerCapture(event.pointerId);
}
function onOverviewMove(event: PointerEvent) {
  if (!windowDrag) return;
  const t = overviewTime(event.clientX);
  const [a, b] = props.view;
  if (windowDrag.mode === 'move') emit('zoom', clamp([t - windowDrag.grab, t - windowDrag.grab + (b - a)]), 'pan');
  else if (windowDrag.mode === 'start') emit('zoom', clamp([Math.min(t, b - minSpan), b]), 'select');
  else emit('zoom', clamp([a, Math.max(t, a + minSpan)]), 'select');
}
function onOverviewUp(event: PointerEvent) {
  windowDrag = null;
  overview.value?.releasePointerCapture(event.pointerId);
}

const clock = (t: number) => {
  const phase = phaseClock(props.phases, t, props.clockMode);
  return `${t.toFixed(2)} s${phase ? ` · ${phase}` : ''}`;
};
const spanText = (seconds: number) => (seconds >= 120 ? `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s` : `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`);
</script>

<template>
  <div class="time-tape">
    <!-- The whole log, and the span shown as a window on it. -->
    <div ref="overview" class="overview" title="The whole log: drag the window to move the span shown, its edges to widen or narrow it"
      @pointerdown="onOverviewDown($event, 'jump')" @pointermove="onOverviewMove" @pointerup="onOverviewUp" @pointercancel="onOverviewUp">
      <div v-for="(segment, i) in overviewSegments" :key="i" class="overview-segment"
        :style="{ left: segment.left, width: segment.width, background: tapeColors[segment.kind] }"></div>
      <div v-if="time !== null" class="overview-time" :style="{ left: pct(ofFull(time)) }"></div>
      <div class="window" :class="{ all: showsAll }" :style="{ left: pct(ofFull(view[0])), width: pct(ofFull(view[1]) - ofFull(view[0])) }"
        @pointerdown="onOverviewDown($event, 'move')">
        <span class="handle start" title="Drag to move the start" @pointerdown="onOverviewDown($event, 'start')"></span>
        <span class="handle end" title="Drag to move the end" @pointerdown="onOverviewDown($event, 'end')"></span>
      </div>
    </div>

    <!-- The span shown, as film. -->
    <div ref="tape" class="tape" role="slider" tabindex="0" aria-label="Time" :aria-valuemin="full[0]" :aria-valuemax="full[1]"
      :aria-valuenow="time ?? undefined" :aria-valuetext="time === null ? 'Nothing pinned' : clock(time)"
      @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp" @pointerleave="hover = null"
      @wheel.prevent="onWheel" @dblclick="onDoubleClick" @contextmenu="openZoomMenu" @keydown="onKey">
      <div class="film">
        <div v-for="(segment, i) in tapeSegmentsShown" :key="i" class="segment" :class="segment.kind"
          :style="{ left: segment.left, width: segment.width, background: tapeColors[segment.kind] }" :title="segment.title">
          <span class="label">{{ segment.label }}</span>
        </div>
      </div>
      <div v-if="hover && !dragging" class="hover-line" :style="{ left: hover.left }"></div>
      <div v-if="time !== null && time >= view[0] && time <= view[1]" class="playhead" :style="{ left: pct(ofView(time)) }"></div>
      <div v-if="hover" class="hover-time" :style="{ left: hover.left }">{{ clock(hover.t) }}</div>
    </div>

    <div class="tape-axis">
      <span>{{ clock(view[0]) }}</span>
      <span class="middle">
        <template v-if="showsAll">All {{ spanText(full[1] - full[0]) }} · scroll to zoom</template>
        <template v-else>{{ spanText(view[1] - view[0]) }} of {{ spanText(full[1] - full[0]) }} ·
          <button class="all-button" @click="showAll">Show all</button></template>
      </span>
      <span>{{ clock(view[1]) }}</span>
    </div>

    <Teleport to="body">
      <div v-if="zoomMenu" class="menu-backdrop" @click="closeZoomMenu" @contextmenu.prevent="closeZoomMenu" @wheel="closeZoomMenu">
        <div class="zoom-menu" role="menu" :style="{ left: `${zoomMenu.x}px`, top: `${zoomMenu.y}px` }" @click.stop>
          <button v-for="choice in zoomMenu.choices" :key="choice.label" type="button" role="menuitem"
            :class="{ divided: choice.label === 'Zoom to the match' }" @click="chooseZoom(choice)">{{ choice.label }}</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.time-tape {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

/* --- The overview --- */
.overview {
  position: relative;
  height: 12px;
  border-radius: 3px;
  background: #1b1d21;
  cursor: pointer;
  touch-action: none;
  user-select: none;
}

.overview-segment {
  position: absolute;
  top: 2px;
  bottom: 2px;
  opacity: 0.7;
}

.overview-segment:first-child {
  border-radius: 2px 0 0 2px;
}

.overview-time {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: #fff;
  pointer-events: none;
}

.window {
  position: absolute;
  top: -2px;
  bottom: -2px;
  box-sizing: border-box;
  min-width: 8px;
  border: 2px solid #fff;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.15);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5);
  cursor: grab;
}

.window.all {
  background: transparent;
}

.handle {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 8px;
  cursor: ew-resize;
}

.handle.start {
  left: -6px;
}

.handle.end {
  right: -6px;
}

/* --- The tape --- */
.tape {
  position: relative;
  height: 34px;
  border-radius: 4px;
  cursor: ew-resize;
  touch-action: none;
  user-select: none;
}

.tape:focus-visible {
  outline: 2px solid #2a78d6;
  outline-offset: 2px;
}

/* The film: a dark strip with sprocket holes along both edges, the
   stretches in the frame between them. */
.film {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: 4px;
  background: #1b1d21;
}

.film::before,
.film::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 6px;
  z-index: 1;
  pointer-events: none;
  background: repeating-linear-gradient(90deg, transparent 0 5px, rgba(255, 255, 255, 0.55) 5px 9px, transparent 9px 14px);
  background-size: 14px 3px;
  background-repeat: repeat-x;
  background-position: 0 center;
}

.film::before {
  top: 0;
  background-color: #1b1d21;
}

.film::after {
  bottom: 0;
  background-color: #1b1d21;
}

.segment {
  position: absolute;
  top: 6px;
  bottom: 6px;
  box-sizing: border-box;
  border-right: 1px solid #1b1d21;
  overflow: hidden;
  display: flex;
  align-items: center;
  padding: 0 6px;
}

.segment.disabled {
  opacity: 0.55;
}

.label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: clip;
  color: #fff;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.5);
}

.playhead,
.hover-line {
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 2px;
  margin-left: -1px;
  pointer-events: none;
}

.playhead {
  background: #fff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
}

.hover-line {
  background: rgba(255, 255, 255, 0.5);
}

.hover-time {
  position: absolute;
  bottom: calc(100% + 6px);
  transform: translateX(-50%);
  z-index: 2;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--tile-background-color);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
}

.tape-axis {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.75rem;
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
}

/* --- The right-click menu --- */
.menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
}

.zoom-menu {
  position: fixed;
  min-width: 180px;
  padding: 4px;
  border: 1px solid rgba(127, 127, 127, 0.6);
  border-radius: 8px;
  background: var(--tile-background-color);
  color: var(--text-color, inherit);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  display: flex;
  flex-direction: column;
}

.zoom-menu button {
  padding: 5px 8px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 0.9rem;
  text-align: left;
  cursor: pointer;
}

.zoom-menu button:hover,
.zoom-menu button:focus-visible {
  background: rgba(127, 127, 127, 0.18);
}

.zoom-menu button.divided {
  margin-top: 2px;
  border-top: 1px solid rgba(127, 127, 127, 0.3);
  border-radius: 0 0 6px 6px;
}

.all-button {
  padding: 0;
  border: none;
  background: none;
  color: #2a78d6;
  font: inherit;
  cursor: pointer;
  text-decoration: underline;
}
</style>
