<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import type { SignalSeries } from '@shared/signals';

const props = defineProps<{
  series: SignalSeries;
  unit: string;
}>();

const height = 240;
const margin = { top: 12, right: 16, bottom: 28, left: 56 };

// The SVG is drawn at the width it's shown at, so text isn't stretched.
const box = ref<HTMLElement | null>(null);
const width = ref(640);
let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver(([entry]) => { width.value = Math.max(240, entry.contentRect.width); });
  if (box.value) observer.observe(box.value);
});
onUnmounted(() => observer?.disconnect());

const values = computed(() => props.series.values as Float64Array);
const isBoolean = computed(() => props.series.kind === 'boolean');

// Round tick values: 1, 2 or 5 times a power of ten, about `count` of them.
function ticks(low: number, high: number, count: number): number[] {
  if (high === low) return [low];
  const rough = (high - low) / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? 10 * power;
  const out: number[] = [];
  for (let t = Math.ceil(low / step) * step; t <= high + step * 1e-9; t += step) out.push(Number(t.toPrecision(12)));
  return out;
}

const xDomain = computed<[number, number]>(() => {
  const t = props.series.times;
  return t.length > 0 ? [t[0], Math.max(t[t.length - 1], t[0] + 1e-6)] : [0, 1];
});
const yDomain = computed<[number, number]>(() => {
  if (isBoolean.value) return [0, 1];
  let low = Infinity;
  let high = -Infinity;
  for (const v of values.value) {
    if (v < low) low = v;
    if (v > high) high = v;
  }
  if (!Number.isFinite(low)) return [0, 1];
  if (low === high) return [low - 1, high + 1];
  const pad = (high - low) * 0.05;
  return [low - pad, high + pad];
});

const plotWidth = computed(() => width.value - margin.left - margin.right);
const plotHeight = height - margin.top - margin.bottom;
const x = (t: number) => margin.left + ((t - xDomain.value[0]) / (xDomain.value[1] - xDomain.value[0])) * plotWidth.value;
const y = (v: number) => margin.top + (1 - (v - yDomain.value[0]) / (yDomain.value[1] - yDomain.value[0])) * plotHeight;

const xTicks = computed(() => ticks(xDomain.value[0], xDomain.value[1], Math.max(2, Math.floor(plotWidth.value / 90))));
const yTicks = computed(() => (isBoolean.value ? [0, 1] : ticks(yDomain.value[0], yDomain.value[1], 4)));

// Booleans are steps: a value holds until the next one.
const path = computed(() => {
  const t = props.series.times;
  const v = values.value;
  let d = '';
  for (let i = 0; i < t.length; i++) {
    if (i === 0) d += `M${x(t[0]).toFixed(1)},${y(v[0]).toFixed(1)}`;
    else if (isBoolean.value) d += `H${x(t[i]).toFixed(1)}V${y(v[i]).toFixed(1)}`;
    else d += `L${x(t[i]).toFixed(1)},${y(v[i]).toFixed(1)}`;
  }
  return d;
});

function formatValue(v: number): string {
  if (isBoolean.value) return v ? 'true' : 'false';
  const text = Math.abs(v) >= 1000 || v === Math.trunc(v) ? v.toFixed(0) : v.toPrecision(4);
  return props.unit ? `${text} ${props.unit}` : text;
}

function formatTick(v: number): string {
  if (isBoolean.value) return v ? 'true' : 'false';
  return Math.abs(v) >= 1e4 ? v.toExponential(1) : String(Number(v.toPrecision(4)));
}

// Hover: the nearest value in time to the pointer.
const hover = ref<number | null>(null);
function onMove(event: PointerEvent) {
  const t = props.series.times;
  if (t.length === 0) return;
  const svg = (event.currentTarget as SVGElement).getBoundingClientRect();
  const time = xDomain.value[0] + ((event.clientX - svg.left - margin.left) / plotWidth.value) * (xDomain.value[1] - xDomain.value[0]);
  let low = 0;
  let high = t.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (t[mid] < time) low = mid + 1;
    else high = mid;
  }
  hover.value = low > 0 && time - t[low - 1] < t[low] - time ? low - 1 : low;
}

// A new series (another signal) is a different length: start again.
watch(() => props.series, () => { hover.value = null; });

const tooltip = computed(() => {
  const i = hover.value;
  if (i === null || i >= props.series.times.length) return null;
  const left = x(props.series.times[i]);
  return {
    left: Math.min(left + 12, width.value - 150),
    top: Math.max(0, y(values.value[i]) - 40),
    cx: left,
    cy: y(values.value[i]),
    time: props.series.times[i].toFixed(3),
    value: formatValue(values.value[i])
  };
});

</script>

<template>
  <div ref="box" class="signal-chart">
    <svg :width="width" :height="height" role="img" :aria-label="`Values over time${unit ? `, in ${unit}` : ''}`"
      @pointermove="onMove" @pointerleave="hover = null">
      <g class="grid">
        <line v-for="t in yTicks" :key="`y${t}`" :x1="margin.left" :x2="width - margin.right" :y1="y(t)" :y2="y(t)" />
      </g>
      <g class="axis">
        <text v-for="t in yTicks" :key="`yl${t}`" :x="margin.left - 8" :y="y(t)" text-anchor="end" dominant-baseline="middle">
          {{ formatTick(t) }}
        </text>
        <text v-for="t in xTicks" :key="`xl${t}`" :x="x(t)" :y="height - 8" text-anchor="middle">{{ t }} s</text>
        <line :x1="margin.left" :x2="width - margin.right" :y1="height - margin.bottom" :y2="height - margin.bottom" />
      </g>
      <path class="line" :d="path" />
      <g v-if="tooltip" class="hover">
        <line :x1="tooltip.cx" :x2="tooltip.cx" :y1="margin.top" :y2="height - margin.bottom" />
        <circle :cx="tooltip.cx" :cy="tooltip.cy" r="4" />
      </g>
      <!-- The whole plot answers the pointer, not just the line. -->
      <rect :x="margin.left" :y="margin.top" :width="plotWidth" :height="plotHeight" fill="transparent" />
    </svg>
    <div v-if="tooltip" class="tooltip" :style="{ left: `${tooltip.left}px`, top: `${tooltip.top}px` }">
      <div class="tooltip-value">{{ tooltip.value }}</div>
      <div class="tooltip-time">at {{ tooltip.time }} s</div>
    </div>
  </div>
</template>

<style scoped>
.signal-chart {
  /* The reference palette's first series colour, validated against the
     card colours of both themes (#fff and #272727). */
  --series-color: #2a78d6;
  position: relative;
  width: 100%;
}

:global([theme='dark']) .signal-chart {
  --series-color: #3987e5;
}

svg {
  display: block;
  touch-action: none;
}

.grid line {
  stroke: currentColor;
  stroke-opacity: 0.1;
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

.line {
  fill: none;
  stroke: var(--series-color);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.hover line {
  stroke: currentColor;
  stroke-opacity: 0.35;
}

.hover circle {
  fill: var(--series-color);
  stroke: var(--tile-background-color);
  stroke-width: 2;
}

.tooltip {
  position: absolute;
  pointer-events: none;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--tile-background-color);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  font-size: 0.85rem;
  white-space: nowrap;
}

.tooltip-value {
  font-weight: 600;
}

.tooltip-time {
  opacity: 0.7;
}
</style>
