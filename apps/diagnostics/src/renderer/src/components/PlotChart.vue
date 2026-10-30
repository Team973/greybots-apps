<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import type { SignalSeries } from '@shared/signals';

export interface ChartLine {
  key: string;
  label: string;
  unit: string;
  color: string;
  // A numeric axis's id, or 'lanes' for a text signal.
  axis: string;
  series: SignalSeries | null;
}

export interface ChartAxis {
  id: string;
  side: 'left' | 'right';
  name: string;
}

const props = defineProps<{
  lines: ChartLine[];
  axes: ChartAxis[];
  // The span shown, and the whole log's, in seconds.
  view: [number, number];
  full: [number, number];
  height: number;
}>();

const emit = defineEmits<{
  zoom: [view: [number, number]];
  // The plot's width in pixels, for how many points are worth reading.
  width: [pixels: number];
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
const numeric = computed(() => props.lines.filter((l) => l.axis !== 'lanes'));

const plot = computed(() => {
  const left = 12 + Math.max(1, leftAxes.value.length) * axisWidth;
  const right = width.value - 12 - rightAxes.value.length * axisWidth;
  const top = 26 + lanes.value.length * laneHeight;
  const bottom = props.height - 28;
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

// Booleans hold their value until the next one, so they're steps.
function linePath(line: ChartLine): string {
  const scale = scales.value.get(line.axis);
  if (!line.series || !scale) return '';
  const { times } = line.series;
  const values = line.series.values as Float64Array;
  const steps = line.series.kind === 'boolean';
  let d = '';
  for (let i = 0; i < times.length; i++) {
    const px = x(times[i]).toFixed(1);
    const py = scale.y(values[i]).toFixed(1);
    if (i === 0) d += `M${px},${py}`;
    else d += steps ? `H${px}V${py}` : `L${px},${py}`;
  }
  return d;
}

// Text signals: one band each, a span per value, labelled where there's room.
function laneSpans(line: ChartLine, row: number) {
  if (!line.series) return [];
  const { times } = line.series;
  const values = line.series.values as string[];
  const y = 22 + row * laneHeight;
  const spans = [];
  for (let i = 0; i < times.length; i++) {
    const from = Math.max(plot.value.left, x(times[i]));
    const to = Math.min(plot.value.right, i + 1 < times.length ? x(times[i + 1]) : plot.value.right);
    if (to <= from) continue;
    const text = values[i];
    spans.push({ key: i, x: from, y, width: to - from, shade: i % 2, text: (to - from) > text.length * 6.5 + 10 ? text : '' });
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

const readout = computed(() => {
  if (hoverX.value === null || dragFrom.value !== null) return null;
  const t = timeAt(hoverX.value);
  const rows = props.lines
    .filter((line) => line.series)
    .map((line) => {
      const at = valueAt(line.series!, t);
      const scale = scales.value.get(line.axis);
      const y = at && scale && line.series!.kind !== 'string' ? scale.y((line.series!.values as Float64Array)[at.index]) : null;
      return { key: line.key, label: line.label, color: line.color, value: at ? formatValue(line, at.index) : '—', y };
    });
  const left = hoverX.value + 14 + 260 > width.value ? hoverX.value - 14 - 260 : hoverX.value + 14;
  return { t, rows, left: Math.max(0, left) };
});

function clampView(start: number, end: number): [number, number] {
  const [fullStart, fullEnd] = props.full;
  let span = Math.max(minSpan, Math.min(end - start, fullEnd - fullStart));
  if (!(span > 0)) span = 1;
  let s = start;
  if (s < fullStart) s = fullStart;
  if (s + span > fullEnd) s = fullEnd - span;
  return [s, s + span];
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  (event.currentTarget as Element).setPointerCapture(event.pointerId);
  dragFrom.value = localX(event);
}

function onPointerMove(event: PointerEvent) {
  const px = localX(event);
  hoverX.value = px >= plot.value.left && px <= plot.value.right ? px : null;
  if (dragFrom.value !== null) hoverX.value = Math.min(plot.value.right, Math.max(plot.value.left, px));
}

function onPointerUp(event: PointerEvent) {
  if (dragFrom.value === null) return;
  const from = dragFrom.value;
  const to = Math.min(plot.value.right, Math.max(plot.value.left, localX(event)));
  dragFrom.value = null;
  if (Math.abs(to - from) < 5) return;
  emit('zoom', clampView(timeAt(Math.min(from, to)), timeAt(Math.max(from, to))));
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
    emit('zoom', clampView(start + delta, end + delta));
    return;
  }
  const anchor = timeAt(Math.min(plot.value.right, Math.max(plot.value.left, localX(event))));
  const factor = Math.pow(1.0015, event.deltaY);
  const newSpan = span * factor;
  const ratio = (anchor - start) / span;
  emit('zoom', clampView(anchor - ratio * newSpan, anchor - ratio * newSpan + newSpan));
}

function onDoubleClick() {
  emit('zoom', [props.full[0], props.full[1]]);
}
</script>

<template>
  <div ref="box" class="plot-chart" :style="{ height: `${height}px` }">
    <svg :width="width" :height="height" role="img" aria-label="Signals over time"
      @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp"
      @pointerleave="hoverX = dragFrom === null ? null : hoverX" @wheel.prevent="onWheel" @dblclick="onDoubleClick">
      <defs>
        <clipPath id="plot-area">
          <rect :x="plot.left" :y="0" :width="plot.width" :height="height" />
        </clipPath>
      </defs>

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

      <g v-for="(line, row) in lanes" :key="line.key" class="lane" clip-path="url(#plot-area)">
        <template v-for="span in laneSpans(line, row)" :key="span.key">
          <rect :x="span.x" :y="span.y" :width="span.width" :height="laneHeight - 4" :class="`shade${span.shade}`" />
          <text v-if="span.text" :x="span.x + 5" :y="span.y + (laneHeight - 4) / 2" dominant-baseline="middle">{{ span.text }}</text>
        </template>
        <rect :x="plot.left - 4" :y="22 + row * laneHeight" width="4" :height="laneHeight - 4" :fill="line.color" />
      </g>

      <g clip-path="url(#plot-area)">
        <path v-for="line in numeric" :key="line.key" class="line" :d="linePath(line)" :stroke="line.color" />
      </g>

      <rect v-if="selection" class="selection" :x="selection.x" :y="plot.top" :width="selection.width" :height="plot.height" />

      <g v-if="readout" class="hover">
        <line :x1="hoverX!" :x2="hoverX!" :y1="plot.top - (lanes.length ? lanes.length * laneHeight + 4 : 0)" :y2="plot.bottom" />
        <circle v-for="row in readout.rows.filter((r) => r.y !== null)" :key="row.key" :cx="hoverX!" :cy="row.y!" r="4"
          :fill="row.color" />
      </g>
    </svg>

    <div v-if="readout && readout.rows.length" class="tooltip" :style="{ left: `${readout.left}px`, top: `${plot.top}px` }">
      <div class="tooltip-time">{{ readout.t.toFixed(3) }} s</div>
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
  fill: currentColor;
  fill-opacity: 0.08;
}

.lane rect.shade1 {
  fill: currentColor;
  fill-opacity: 0.16;
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
  box-sizing: border-box;
  pointer-events: none;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--tile-background-color);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
  font-size: 0.8rem;
}

.tooltip-time {
  opacity: 0.7;
  margin-bottom: 4px;
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
