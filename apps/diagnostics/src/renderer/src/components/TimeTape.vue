<script setup lang="ts">
import { computed, ref } from 'vue';

import { phaseClock, tapeLabels, tapeSegments, type MatchPhase, type TapeKind } from '@shared/events';

// The playback tape: the whole log as a strip of film, coloured by what the
// robot was doing (disabled, auto, teleop, endgame), with the span the line
// chart shows bracketed and the moment shown (the pin, or the playhead) as
// a line across it. Click or drag anywhere to move the moment: every tab
// (the line chart, the field, the 3D robot, the console) shows the same one.

const props = defineProps<{
  full: [number, number];
  view: [number, number];
  // The moment shown, or null when nothing's pinned.
  time: number | null;
  phases: MatchPhase[];
  enabled: [number, number][];
}>();

const emit = defineEmits<{
  seek: [time: number];
}>();

const tapeColors: Record<TapeKind, string> = {
  disabled: '#6b7079',
  enabled: '#2a78d6',
  auto: '#c98500',
  teleop: '#2e9e5b',
  endgame: '#1d6e43'
};

const length = computed(() => Math.max(1e-9, props.full[1] - props.full[0]));
const share = (t: number) => Math.min(1, Math.max(0, (t - props.full[0]) / length.value));
const percent = (t: number) => `${share(t) * 100}%`;

const segments = computed(() => tapeSegments(props.full, props.phases, props.enabled).map((s) => ({
  ...s,
  left: percent(s.start),
  width: `${(share(s.end) - share(s.start)) * 100}%`,
  // Named in it where there's room; always in its hover text.
  label: tapeLabels[s.kind],
  title: `${tapeLabels[s.kind]}: ${s.start.toFixed(1)}–${s.end.toFixed(1)} s (${(s.end - s.start).toFixed(1)} s)`
})));

const tape = ref<HTMLElement | null>(null);
const timeAt = (clientX: number) => {
  const box = tape.value!.getBoundingClientRect();
  return props.full[0] + Math.min(1, Math.max(0, (clientX - box.left) / box.width)) * length.value;
};

// Dragging moves the moment as it goes; hovering shows where a click lands.
const dragging = ref(false);
const hover = ref<{ t: number; left: string } | null>(null);
function onDown(event: PointerEvent) {
  if (event.button !== 0) return;
  dragging.value = true;
  tape.value!.setPointerCapture(event.pointerId);
  emit('seek', timeAt(event.clientX));
}
function onMove(event: PointerEvent) {
  const t = timeAt(event.clientX);
  hover.value = { t, left: percent(t) };
  if (dragging.value) emit('seek', t);
}
function onUp(event: PointerEvent) {
  dragging.value = false;
  tape.value?.releasePointerCapture(event.pointerId);
}

// The arrow keys step a tenth of a second (Shift: a second); Home and End.
function onKey(event: KeyboardEvent) {
  const now = props.time ?? props.view[0];
  const step = event.shiftKey ? 1 : 0.1;
  const to = event.key === 'ArrowLeft' ? now - step : event.key === 'ArrowRight' ? now + step
    : event.key === 'Home' ? props.full[0] : event.key === 'End' ? props.full[1] : null;
  if (to === null) return;
  event.preventDefault();
  emit('seek', Math.min(props.full[1], Math.max(props.full[0], to)));
}

const clock = (t: number) => {
  const phase = phaseClock(props.phases, t);
  return `${t.toFixed(2)} s${phase ? ` · ${phase}` : ''}`;
};
</script>

<template>
  <div ref="tape" class="tape" role="slider" tabindex="0" aria-label="Time" :aria-valuemin="full[0]" :aria-valuemax="full[1]"
    :aria-valuenow="time ?? undefined" :aria-valuetext="time === null ? 'Nothing pinned' : clock(time)"
    @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp" @pointerleave="hover = null" @keydown="onKey">
    <div class="film">
      <div v-for="(segment, i) in segments" :key="i" class="segment" :class="segment.kind"
        :style="{ left: segment.left, width: segment.width, background: tapeColors[segment.kind] }" :title="segment.title">
        <span class="label">{{ segment.label }}</span>
      </div>
    </div>
    <!-- The span the line chart shows. -->
    <div class="window" :style="{ left: percent(view[0]), width: `${(share(view[1]) - share(view[0])) * 100}%` }"></div>
    <div v-if="hover && !dragging" class="hover-line" :style="{ left: hover.left }"></div>
    <div v-if="time !== null" class="playhead" :style="{ left: percent(time) }"></div>
    <div v-if="hover" class="hover-time" :style="{ left: hover.left }">{{ clock(hover.t) }}</div>
  </div>
</template>

<style scoped>
.tape {
  position: relative;
  flex: 1;
  min-width: 0;
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

.window {
  position: absolute;
  top: 1px;
  bottom: 1px;
  box-sizing: border-box;
  min-width: 2px;
  border: 1.5px solid rgba(255, 255, 255, 0.85);
  border-radius: 3px;
  pointer-events: none;
  background: rgba(255, 255, 255, 0.08);
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
</style>
