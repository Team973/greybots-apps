<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';

import { phaseClock, phaseLabels, type MatchPhase } from '@shared/events';
import type { SignalSeries } from '@shared/signals';
import type { ChartSnapshot } from '@/chart-image';

export interface ChartLine {
  key: string;
  label: string;
  unit: string;
  color: string;
  // A numeric axis's id, or 'lanes' for a band (text, or numbers shown as
  // states).
  axis: string;
  // In a band: above the plot or below it.
  band: 'top' | 'bottom';
  series: SignalSeries | null;
}

export interface ChartAxis {
  id: string;
  side: 'left' | 'right';
  name: string;
}

// Something that happened, marked along the top of the plot: a moment, or
// a span when `end` is set.
export interface ChartMarker {
  id: string;
  start: number;
  end: number | null;
  color: string;
  title: string;
}

const props = withDefaults(defineProps<{
  lines: ChartLine[];
  axes: ChartAxis[];
  // The span shown, and the whole log's, in seconds.
  view: [number, number];
  full: [number, number];
  height: number;
  markers?: ChartMarker[];
  // The match's phases, shaded behind the plot.
  phases?: MatchPhase[];
  // The marker picked (in the event list), drawn out.
  selectedMarker?: string | null;
  // What the pinned readout's called: 'Pinned at', or while playing back, 'Playing at'.
  pinLabel?: string;
}>(), { markers: () => [], phases: () => [], selectedMarker: null, pinLabel: 'Pinned at' });

// The pinned moment, in seconds, or null. The page moves it too (playing
// back, jumping to an event).
const pin = defineModel<number | null>('pin', { default: null });

// How a zoom came about: the wheel (zooming), Shift+wheel (panning), a drag
// across the plot, or a double-click (everything).
export type ZoomGesture = 'wheel' | 'pan' | 'select' | 'all';

const emit = defineEmits<{
  zoom: [view: [number, number], gesture: ZoomGesture];
  // The plot's width in pixels, for how many points are worth reading.
  width: [pixels: number];
  // A marker clicked.
  marker: [id: string];
}>();

const axisWidth = 58;
const laneHeight = 20;
const minSpan = 0.01;

const box = ref<HTMLElement | null>(null);
const width = ref(800);
let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver(([entry]) => { width.value = Math.max(320, entry.contentRect.width); });
  if (box.value) observer.observe(box.value);
});
onUnmounted(() => observer?.disconnect());

const leftAxes = computed(() => props.axes.filter((a) => a.side === 'left'));
const rightAxes = computed(() => props.axes.filter((a) => a.side === 'right'));
const lanes = computed(() => props.lines.filter((l) => l.axis === 'lanes'));
const topLanes = computed(() => lanes.value.filter((l) => l.band !== 'bottom'));
const bottomLanes = computed(() => lanes.value.filter((l) => l.band === 'bottom'));
const numeric = computed(() => props.lines.filter((l) => l.axis !== 'lanes'));

const plot = computed(() => {
  const left = 12 + Math.max(1, leftAxes.value.length) * axisWidth;
  const right = width.value - 12 - rightAxes.value.length * axisWidth;
  const top = 26 + topLanes.value.length * laneHeight;
  const bottom = props.height - 28 - bottomLanes.value.length * laneHeight;
  return { left, right, top, bottom, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
});
watch(() => plot.value.width, (w) => emit('width', w), { immediate: true });

const x = (t: number) => plot.value.left + ((t - props.view[0]) / (props.view[1] - props.view[0])) * plot.value.width;
const timeAt = (px: number) => props.view[0] + ((px - plot.value.left) / plot.value.width) * (props.view[1] - props.view[0]);

// Round tick values: 1, 2 or 5 times a power of ten, about `count` of them.
function ticks(low: number, high: number, count: number): number[] {
  if (!(high > low)) return [low];
  const rough = (high - low) / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? 10 * power;
  const out: number[] = [];
  for (let t = Math.ceil(low / step) * step; t <= high + step * 1e-9; t += step) out.push(Number(t.toPrecision(12)));
  return out;
}

function formatTick(v: number): string {
  return Math.abs(v) >= 1e5 ? v.toExponential(1) : String(Number(v.toPrecision(4)));
}

// Each axis fits the values of its signals in the span shown.
const scales = computed(() => {
  const out = new Map<string, { domain: [number, number]; y: (v: number) => number; ticks: number[] }>();
  for (const axis of props.axes) {
    let low = Infinity;
    let high = -Infinity;
    let boolean = false;
    for (const line of numeric.value) {
      if (line.axis !== axis.id || !line.series) continue;
      if (line.series.kind === 'boolean') boolean = true;
      const { times } = line.series;
      const values = line.series.values as Float64Array;
      for (let i = 0; i < times.length; i++) {
        if (times[i] < props.view[0] || times[i] > props.view[1]) continue;
        if (values[i] < low) low = values[i];
        if (values[i] > high) high = values[i];
      }
    }
    if (boolean) {
      low = Math.min(low, 0);
      high = Math.max(high, 1);
    }
    if (!Number.isFinite(low)) [low, high] = [0, 1];
    if (low === high) [low, high] = [low - 1, high + 1];
    const pad = (high - low) * 0.06;
    const domain: [number, number] = [low - pad, high + pad];
    const { top, height } = plot.value;
    out.set(axis.id, {
      domain,
      y: (v: number) => top + (1 - (v - domain[0]) / (domain[1] - domain[0])) * height,
      ticks: ticks(domain[0], domain[1], Math.max(2, Math.floor(height / 55)))
    });
  }
  return out;
});

// Where each axis's line is drawn: L1 next to the plot, L2 outside it, ...
function axisX(axis: ChartAxis): number {
  const list = axis.side === 'left' ? leftAxes.value : rightAxes.value;
  const i = list.indexOf(axis);
  return axis.side === 'left' ? plot.value.left - i * axisWidth : plot.value.right + i * axisWidth;
}

function axisUnits(axis: ChartAxis): string {
  const units = [...new Set(numeric.value.filter((l) => l.axis === axis.id && l.unit).map((l) => l.unit))];
  return units.join(', ');
}

const xTicks = computed(() => ticks(props.view[0], props.view[1], Math.max(2, Math.floor(plot.value.width / 100))));
const gridAxis = computed(() => leftAxes.value[0] ?? rightAxes.value[0]);

// Steps: a value is only logged when it changes, so it holds until the
// next one, and the last one holds to the end of the log. A straight line
// between two values minutes apart would show a ramp that never happened.
function linePath(line: ChartLine): string {
  const scale = scales.value.get(line.axis);
  if (!line.series || !scale || line.series.times.length === 0) return '';
  const { times } = line.series;
  const values = line.series.values as Float64Array;
  let d = '';
  for (let i = 0; i < times.length; i++) {
    const px = x(times[i]).toFixed(1);
    const py = scale.y(values[i]).toFixed(1);
    d += i === 0 ? `M${px},${py}` : `H${px}V${py}`;
  }
  return `${d}H${x(Math.max(props.full[1], times[times.length - 1])).toFixed(1)}`;
}

// Where a band's row is: the top ones above the plot, the bottom ones
// between it and the time labels.
function laneY(line: ChartLine): number {
  if (line.band === 'bottom') return plot.value.bottom + 4 + bottomLanes.value.indexOf(line) * laneHeight;
  return 22 + topLanes.value.indexOf(line) * laneHeight;
}

// Bands: one each in the signal's colour, a span per value (alternately
// lighter and darker; for true/false, true is the darker), labelled where
// there's room. A value repeated is one span.
function laneSpans(line: ChartLine) {
  if (!line.series) return [];
  const { times } = line.series;
  const y = laneY(line);
  const spans = [];
  let shade = 0;
  for (let i = 0; i < times.length; i++) {
    const text = formatValue(line, i);
    let next = i + 1;
    while (next < times.length && formatValue(line, next) === text) next++;
    const from = Math.max(plot.value.left, x(times[i]));
    const to = Math.min(plot.value.right, next < times.length ? x(times[next]) : plot.value.right);
    i = next - 1;
    if (to <= from) continue;
    shade = line.series.kind === 'boolean' ? (text === 'true' ? 1 : 0) : 1 - shade;
    spans.push({ key: i, x: from, y, width: to - from, shade, text: (to - from) > text.length * 6.5 + 10 ? text : '' });
  }
  return spans;
}

// The last value at or before time t (values hold until the next).
function valueAt(series: SignalSeries, t: number): { index: number } | null {
  const { times } = series;
  let low = 0;
  let high = times.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (times[mid] <= t) low = mid + 1;
    else high = mid;
  }
  return low === 0 ? null : { index: low - 1 };
}

function formatValue(line: ChartLine, index: number): string {
  const series = line.series!;
  if (series.kind === 'string') return (series.values as string[])[index];
  const v = (series.values as Float64Array)[index];
  if (series.kind === 'boolean') return v ? 'true' : 'false';
  const text = Math.abs(v) >= 1000 || v === Math.trunc(v) ? v.toFixed(0) : v.toPrecision(4);
  return line.unit ? `${text} ${line.unit}` : text;
}

// --- Pointer: hover readout, drag to zoom, wheel to zoom and pan ---

const hoverX = ref<number | null>(null);
const dragFrom = ref<number | null>(null);

function localX(event: PointerEvent | WheelEvent | MouseEvent): number {
  return event.clientX - (box.value?.getBoundingClientRect().left ?? 0);
}

function localY(event: PointerEvent | MouseEvent): number {
  return event.clientY - (box.value?.getBoundingClientRect().top ?? 0);
}

// --- Markers and phases ---

const markerHeight = 11;
const spanHeight = 3;
const markerY = computed(() => plot.value.top + 1);

// Each marker where it is on screen; moments get a few pixels to be seen
// and hit.
const shownMarkers = computed(() => {
  const [start, end] = props.view;
  return props.markers
    .filter((m) => (m.end ?? m.start) >= start && m.start <= end)
    .map((m) => {
      const from = Math.max(plot.value.left, x(m.start));
      const to = m.end === null ? from : Math.min(plot.value.right, x(m.end));
      // Its start is marked where it's in view.
      return { ...m, x: from, width: Math.max(0, to - from), moment: m.end === null || to - from < 3, starts: m.start >= start };
    });
});

// Markers under the pointer: on the marker strip, within a few pixels.
const hoverY = ref<number | null>(null);
function markersAt(px: number, py: number | null) {
  if (py === null || py < markerY.value - 4 || py > markerY.value + markerHeight + 4) return [];
  // Nearest start first: a mark is what's aimed at, more than a long span under it.
  const distance = (m: (typeof shownMarkers.value)[number]) => (m.starts ? Math.abs(px - m.x) : 6);
  return shownMarkers.value.filter((m) => px >= m.x - 5 && px <= m.x + m.width + 5).sort((a, b) => distance(a) - distance(b));
}

const shownPhases = computed(() => props.phases
  .filter((p) => p.end >= props.view[0] && p.start <= props.view[1])
  .map((p) => {
    const from = Math.max(plot.value.left, x(p.start));
    const to = Math.min(plot.value.right, x(p.end));
    return { ...p, x: from, width: Math.max(0, to - from), label: phaseLabels[p.name] };
  }));

const phaseText = (t: number) => phaseClock(props.phases, t);

// Every signal's value at time t, from what's been read (the span shown).
function rowsAt(t: number) {
  return props.lines
    .filter((line) => line.series)
    .map((line) => {
      const at = valueAt(line.series!, t);
      const scale = scales.value.get(line.axis);
      const y = at && scale && line.axis !== 'lanes' ? scale.y((line.series!.values as Float64Array)[at.index]) : null;
      return { key: line.key, label: line.label, color: line.color, value: at ? formatValue(line, at.index) : '—', y };
    });
}

const tooltipWidth = 260;
// Beside x, on whichever side there's room.
const besideX = (px: number) => Math.max(0, px + 14 + tooltipWidth > width.value ? px - 14 - tooltipWidth : px + 14);

const readout = computed(() => {
  if (hoverX.value === null || dragFrom.value !== null) return null;
  const t = timeAt(hoverX.value);
  return { t, rows: rowsAt(t), left: besideX(hoverX.value), markers: markersAt(hoverX.value, hoverY.value), phase: phaseText(t) };
});

// A click pins a moment: its values stay in their own readout while the
// pointer reads elsewhere (and, live, while the chart moves along). Once
// the moment is out of the span shown, its values are as they were last
// seen. A click elsewhere moves it; its ✕ or Escape lets it go.
const pinRows = shallowRef<ReturnType<typeof rowsAt>>([]);
const pinInView = computed(() => pin.value !== null && pin.value >= props.view[0] && pin.value <= props.view[1]);
watch([pin, () => props.lines, () => props.view], () => {
  if (pin.value === null) pinRows.value = [];
  else if (pinInView.value) pinRows.value = rowsAt(pin.value);
}, { immediate: true });
const pinReadout = computed(() => {
  if (pin.value === null) return null;
  const px = pinInView.value ? x(pin.value) : null;
  return { t: pin.value, rows: pinRows.value, x: px, left: px === null ? plot.value.left : besideX(px), phase: phaseText(pin.value) };
});

// Clicks and double-clicks are told apart here from pointer-ups, not by
// the browser's click events: while live, the chart redraws under the
// pointer, and the browser doesn't count a press and release on a redrawn
// element as a click. A double-click is two clicks first, so it puts the
// pin back where it was before them.
const doubleClickMs = 500;
let lastClick: { x: number; at: number; pinBefore: number | null } | null = null;
function onClick(px: number, py: number | null) {
  // A marker: picked, not pinned.
  const hit = markersAt(px, py);
  if (hit.length) {
    emit('marker', hit[0].id);
    return;
  }
  const now = Date.now();
  if (lastClick && now - lastClick.at < doubleClickMs && Math.abs(px - lastClick.x) < 6) {
    pin.value = lastClick.pinBefore;
    lastClick = null;
    emit('zoom', [props.full[0], props.full[1]], 'all');
    return;
  }
  lastClick = { x: px, at: now, pinBefore: pin.value };
  if (px >= plot.value.left && px <= plot.value.right) pin.value = timeAt(px);
}

function onKey(event: KeyboardEvent) {
  const typing = event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]');
  if (event.key === 'Escape' && !typing) pin.value = null;
}
onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));

// What a copy of the chart as an image needs (chart-image.ts).
const svgElement = ref<SVGSVGElement | null>(null);
function snapshot(): ChartSnapshot | null {
  if (!svgElement.value) return null;
  const pin = pinReadout.value;
  return {
    svg: svgElement.value,
    pinned: pin && pin.rows.length
      ? {
          title: `${props.pinLabel} ${pin.t.toFixed(3)} s${pin.phase ? ` (${pin.phase})` : ''}${pin.x === null ? ', out of view' : ''}`,
          left: pin.left,
          bottom: props.height - plot.value.bottom + 4,
          rows: pin.rows.map((row) => ({ color: row.color, label: row.label, value: row.value }))
        }
      : null
  };
}
defineExpose({ snapshot });

const formatDelta = (seconds: number) => `${seconds >= 0 ? '+' : '−'}${Math.abs(seconds).toFixed(3)} s`;

function clampView(start: number, end: number): [number, number] {
  const [fullStart, fullEnd] = props.full;
  let span = Math.max(minSpan, Math.min(end - start, fullEnd - fullStart));
  if (!(span > 0)) span = 1;
  let s = start;
  if (s < fullStart) s = fullStart;
  if (s + span > fullEnd) s = fullEnd - span;
  return [s, s + span];
}

let downY: number | null = null;
function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  (event.currentTarget as Element).setPointerCapture(event.pointerId);
  dragFrom.value = localX(event);
  downY = localY(event);
}

function onPointerMove(event: PointerEvent) {
  const px = localX(event);
  hoverY.value = localY(event);
  hoverX.value = px >= plot.value.left && px <= plot.value.right ? px : null;
  if (dragFrom.value !== null) hoverX.value = Math.min(plot.value.right, Math.max(plot.value.left, px));
}

function onPointerUp(event: PointerEvent) {
  if (dragFrom.value === null) return;
  const from = dragFrom.value;
  const to = Math.min(plot.value.right, Math.max(plot.value.left, localX(event)));
  dragFrom.value = null;
  if (Math.abs(to - from) < 5) {
    onClick(from, downY);
    return;
  }
  emit('zoom', clampView(timeAt(Math.min(from, to)), timeAt(Math.max(from, to))), 'select');
}

const selection = computed(() => {
  if (dragFrom.value === null || hoverX.value === null) return null;
  return { x: Math.min(dragFrom.value, hoverX.value), width: Math.abs(hoverX.value - dragFrom.value) };
});

function onWheel(event: WheelEvent) {
  const [start, end] = props.view;
  const span = end - start;
  const pan = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY);
  if (pan) {
    const delta = (event.shiftKey ? event.deltaY : event.deltaX) / plot.value.width * span;
    emit('zoom', clampView(start + delta, end + delta), 'pan');
    return;
  }
  const anchor = timeAt(Math.min(plot.value.right, Math.max(plot.value.left, localX(event))));
  const factor = Math.pow(1.0015, event.deltaY);
  const newSpan = span * factor;
  const ratio = (anchor - start) / span;
  emit('zoom', clampView(anchor - ratio * newSpan, anchor - ratio * newSpan + newSpan), 'wheel');
}

</script>

<template>
  <div ref="box" class="plot-chart" :style="{ height: `${height}px` }">
    <svg ref="svgElement" :width="width" :height="height" role="img" aria-label="Signals over time"
      @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp"
      @pointerleave="hoverX = dragFrom === null ? null : hoverX" @wheel.prevent="onWheel">
      <defs>
        <clipPath id="plot-area">
          <rect :x="plot.left" :y="0" :width="plot.width" :height="height" />
        </clipPath>
      </defs>

      <g class="phases">
        <template v-for="phase in shownPhases" :key="`${phase.name}${phase.start}`">
          <rect :class="phase.name" :x="phase.x" :y="plot.top" :width="phase.width" :height="plot.height" />
          <text v-if="phase.width > 50" :x="phase.x + 5" :y="plot.top + markerHeight + 12">{{ phase.label }}</text>
        </template>
      </g>

      <g v-if="gridAxis && scales.get(gridAxis.id)" class="grid">
        <line v-for="t in scales.get(gridAxis.id)!.ticks" :key="`g${t}`" :x1="plot.left" :x2="plot.right"
          :y1="scales.get(gridAxis.id)!.y(t)" :y2="scales.get(gridAxis.id)!.y(t)" />
      </g>
      <g class="grid">
        <line v-for="t in xTicks" :key="`gx${t}`" :x1="x(t)" :x2="x(t)" :y1="plot.top" :y2="plot.bottom" />
      </g>

      <g v-for="axis in axes" :key="axis.id" class="axis">
        <line :x1="axisX(axis)" :x2="axisX(axis)" :y1="plot.top" :y2="plot.bottom" />
        <text v-for="t in scales.get(axis.id)?.ticks ?? []" :key="t"
          :x="axis.side === 'left' ? axisX(axis) - 6 : axisX(axis) + 6" :y="scales.get(axis.id)!.y(t)"
          :text-anchor="axis.side === 'left' ? 'end' : 'start'" dominant-baseline="middle">{{ formatTick(t) }}</text>
        <text class="axis-name" :x="axis.side === 'left' ? axisX(axis) - 6 : axisX(axis) + 6" :y="plot.top - 8"
          :text-anchor="axis.side === 'left' ? 'end' : 'start'">{{ axis.name }}{{ axisUnits(axis) ? ` ${axisUnits(axis)}` : '' }}</text>
      </g>
      <g class="axis">
        <line :x1="plot.left" :x2="plot.right" :y1="plot.bottom" :y2="plot.bottom" />
        <text v-for="t in xTicks" :key="`x${t}`" :x="x(t)" :y="height - 9" text-anchor="middle">{{ formatTick(t) }} s</text>
      </g>

      <g v-for="line in lanes" :key="line.key" class="lane" clip-path="url(#plot-area)">
        <template v-for="span in laneSpans(line)" :key="span.key">
          <rect :x="span.x" :y="span.y" :width="Math.max(1, span.width - (span.width > 3 ? 1 : 0))" :height="laneHeight - 4"
            :fill="line.color" :class="`shade${span.shade}`" />
          <text v-if="span.text" :x="span.x + 5" :y="span.y + (laneHeight - 4) / 2" dominant-baseline="middle">{{ span.text }}</text>
        </template>
      </g>

      <g clip-path="url(#plot-area)">
        <path v-for="line in numeric" :key="line.key" class="line" :d="linePath(line)" :stroke="line.color" />
      </g>

      <g class="markers" clip-path="url(#plot-area)">
        <!-- Spans as a thin bar along the strip's foot, moments as marks over
          them, so a long span can't hide what happened during it. -->
        <template v-for="marker in shownMarkers" :key="marker.id">
          <line v-if="marker.id === selectedMarker" class="marker-line" :x1="marker.x" :x2="marker.x" :y1="plot.top" :y2="plot.bottom"
            :stroke="marker.color" />
          <rect v-if="!marker.moment" :x="marker.x" :y="markerY + markerHeight - spanHeight" :width="marker.width" :height="spanHeight"
            rx="1" :fill="marker.color" :class="{ selected: marker.id === selectedMarker }" />
        </template>
        <template v-for="marker in shownMarkers" :key="`m${marker.id}`">
          <path v-if="marker.starts" :d="`M${marker.x - 4},${markerY}h8l-4,${markerHeight - spanHeight}z`" :fill="marker.color"
            :class="{ selected: marker.id === selectedMarker }" />
        </template>
      </g>

      <line v-if="pinReadout && pinReadout.x !== null" class="pin-line" :x1="pinReadout.x" :x2="pinReadout.x"
        :y1="plot.top - (topLanes.length ? topLanes.length * laneHeight + 4 : 0)" :y2="plot.bottom + bottomLanes.length * laneHeight" />

      <rect v-if="selection" class="selection" :x="selection.x" :y="plot.top" :width="selection.width" :height="plot.height" />

      <g v-if="readout" class="hover">
        <line :x1="hoverX!" :x2="hoverX!" :y1="plot.top - (topLanes.length ? topLanes.length * laneHeight + 4 : 0)"
          :y2="plot.bottom + bottomLanes.length * laneHeight" />
        <circle v-for="row in readout.rows.filter((r) => r.y !== null)" :key="row.key" :cx="hoverX!" :cy="row.y!" r="4"
          :fill="row.color" />
      </g>
    </svg>

    <div v-if="pinReadout && pinReadout.rows.length" class="tooltip pinned"
      :style="{ left: `${pinReadout.left}px`, bottom: `${height - plot.bottom + 4}px` }">
      <div class="tooltip-time">
        <span>{{ pinLabel }} {{ pinReadout.t.toFixed(3) }} s<template v-if="pinReadout.phase"> · {{ pinReadout.phase }}</template><template
          v-if="pinReadout.x === null">, out of view</template></span>
        <button class="unpin" aria-label="Unpin" title="Unpin (Esc)" @pointerdown.stop @click="pin = null">✕</button>
      </div>
      <div v-for="row in pinReadout.rows" :key="row.key" class="tooltip-row">
        <span class="swatch" :style="{ background: row.color }"></span>
        <span class="tooltip-label">{{ row.label }}</span>
        <span class="tooltip-value">{{ row.value }}</span>
      </div>
    </div>

    <div v-if="readout && (readout.rows.length || readout.markers.length)" class="tooltip"
      :style="{ left: `${readout.left}px`, top: `${plot.top + markerHeight + 4}px` }">
      <div class="tooltip-time">
        <span>{{ readout.t.toFixed(3) }} s<template v-if="readout.phase"> · {{ readout.phase }}</template></span>
        <span v-if="pin !== null" class="delta">{{ formatDelta(readout.t - pin) }} from the pin</span>
      </div>
      <div v-for="marker in readout.markers.slice(0, 4)" :key="marker.id" class="tooltip-row marker-row">
        <span class="swatch" :style="{ background: marker.color }"></span>
        <span class="tooltip-label">{{ marker.title }}</span>
      </div>
      <div v-if="readout.markers.length > 4" class="tooltip-row hint">and {{ readout.markers.length - 4 }} more</div>
      <div v-for="row in readout.rows" :key="row.key" class="tooltip-row">
        <span class="swatch" :style="{ background: row.color }"></span>
        <span class="tooltip-label">{{ row.label }}</span>
        <span class="tooltip-value">{{ row.value }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.plot-chart {
  position: relative;
  width: 100%;
  user-select: none;
}

svg {
  display: block;
  touch-action: none;
  cursor: crosshair;
}

.grid line {
  stroke: currentColor;
  stroke-opacity: 0.08;
}

.axis line {
  stroke: currentColor;
  stroke-opacity: 0.3;
}

.axis text {
  fill: currentColor;
  fill-opacity: 0.65;
  font-size: 11px;
}

.axis .axis-name {
  fill-opacity: 0.85;
  font-weight: 600;
}

.line {
  fill: none;
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.lane rect.shade0 {
  fill-opacity: 0.28;
}

.lane rect.shade1 {
  fill-opacity: 0.5;
}

.lane text {
  fill: currentColor;
  font-size: 11px;
}

.selection {
  fill: currentColor;
  fill-opacity: 0.1;
  stroke: currentColor;
  stroke-opacity: 0.3;
}

.hover line {
  stroke: currentColor;
  stroke-opacity: 0.35;
}

.hover circle {
  stroke: var(--tile-background-color);
  stroke-width: 2;
}

.tooltip {
  position: absolute;
  width: 260px;
  z-index: 1;
  box-sizing: border-box;
  pointer-events: none;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--tile-background-color);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
  font-size: 0.8rem;
}

.tooltip-time {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  opacity: 0.7;
  margin-bottom: 4px;
}

/* Only its ✕ takes the pointer: the chart under it still zooms and reads. */
.tooltip.pinned {
  border: 1px solid rgba(127, 127, 127, 0.5);
}

.tooltip.pinned .tooltip-time {
  opacity: 0.85;
  font-weight: 600;
}

.unpin {
  pointer-events: auto;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 0 2px;
}

.phases rect {
  fill: currentColor;
  fill-opacity: 0.035;
}

.phases rect.auto,
.phases rect.endgame {
  fill-opacity: 0.08;
}

.phases text {
  fill: currentColor;
  fill-opacity: 0.55;
  font-size: 11px;
  font-weight: 600;
}

.markers rect,
.markers path {
  cursor: pointer;
  fill-opacity: 0.85;
}

.markers .selected {
  fill-opacity: 1;
  stroke: currentColor;
  stroke-width: 1.5;
}

.marker-line {
  stroke-width: 1.5;
  stroke-opacity: 0.8;
}

.marker-row .tooltip-label {
  white-space: normal;
}

.pin-line {
  stroke: currentColor;
  stroke-opacity: 0.7;
  stroke-width: 1.5;
  stroke-dasharray: 4 3;
}

.tooltip-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.tooltip-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tooltip-value {
  max-width: 65%;
  overflow-wrap: anywhere;
  text-align: right;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.swatch {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
</style>
