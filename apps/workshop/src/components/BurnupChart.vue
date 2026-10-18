<script setup lang="ts">
import { computed, ref } from 'vue';
import { addDays, formatDay, formatDate, parseDate } from '@/lib/dates';
import type { Burnup } from '@/lib/milestones';

// A milestone's burnup: scope (tickets meant to get done) and done, day by
// day, as two lines on one count axis. When the milestone has a pace, a
// dashed line carries "done" on to where it meets the scope: the forecast.
// The target date, if there is one, is a vertical marker. Hovering (or
// arrowing along) shows every value for that day, and the same numbers are
// available as a table.
const props = defineProps<{ data: Burnup; targetDate: string | null }>();

const width = 640;
const height = 240;
const pad = { top: 16, right: 64, bottom: 28, left: 34 };
const plotW = width - pad.left - pad.right;
const plotH = height - pad.top - pad.bottom;

// A forecast more than a year out isn't drawn (it would squash the history);
// it's still stated in words.
const maxForecastDays = 365;

const first = computed(() => props.data.points[0]?.date ?? '');
const last = computed(() => props.data.points[props.data.points.length - 1]?.date ?? '');
const forecastDrawn = computed(() => {
  const f = props.data.forecast;
  return f && dayIndex(f) - dayIndex(last.value) <= maxForecastDays ? f : null;
});
const end = computed(() => {
  let e = last.value;
  if (forecastDrawn.value && forecastDrawn.value > e) e = forecastDrawn.value;
  if (props.targetDate && props.targetDate > e && dayIndex(props.targetDate) - dayIndex(last.value) <= maxForecastDays) e = props.targetDate;
  // At least a week wide, so a brand-new milestone isn't a single column.
  return dayIndex(e) - dayIndex(first.value) < 7 ? addDays(first.value, 7) : e;
});

function dayIndex(date: string) {
  return Math.round(parseDate(date).getTime() / 86_400_000);
}
const span = computed(() => Math.max(1, dayIndex(end.value) - dayIndex(first.value)));
const x = (date: string) => pad.left + ((dayIndex(date) - dayIndex(first.value)) / span.value) * plotW;

const maxY = computed(() => Math.max(4, ...props.data.points.map((p) => p.scope)));
// Round count ticks: 0, then up to four more.
const ticks = computed(() => {
  const step = Math.max(1, Math.ceil(maxY.value / 4));
  const out: number[] = [];
  for (let v = 0; v <= maxY.value + step - 1 && out.length < 6; v += step) out.push(v);
  return out;
});
const top = computed(() => ticks.value[ticks.value.length - 1]);
const y = (v: number) => pad.top + plotH - (v / top.value) * plotH;

// Counts change in steps, so the lines are drawn as steps.
function stepPath(key: 'scope' | 'done') {
  const pts = props.data.points;
  if (!pts.length) return '';
  let d = `M${x(pts[0].date)},${y(pts[0][key])}`;
  for (let i = 1; i < pts.length; i++) d += `H${x(pts[i].date)}V${y(pts[i][key])}`;
  return d;
}
const scopePath = computed(() => stepPath('scope'));
const donePath = computed(() => stepPath('done'));
const lastPoint = computed(() => props.data.points[props.data.points.length - 1]);

const xLabels = computed(() => {
  const labels = [first.value, end.value];
  return labels.map((date) => ({ date, x: x(date), text: formatDay(date) }));
});

// --- Hover ---
const hovered = ref<number | null>(null);
const svg = ref<SVGSVGElement | null>(null);
function onMove(event: PointerEvent) {
  const rect = svg.value!.getBoundingClientRect();
  const px = ((event.clientX - rect.left) / rect.width) * width;
  const day = Math.round(((px - pad.left) / plotW) * span.value);
  hovered.value = day < 0 || day >= props.data.points.length ? null : day;
}
function onKey(event: KeyboardEvent) {
  const n = props.data.points.length;
  if (event.key === 'ArrowRight') hovered.value = Math.min(n - 1, (hovered.value ?? -1) + 1);
  else if (event.key === 'ArrowLeft') hovered.value = Math.max(0, (hovered.value ?? n) - 1);
  else return;
  event.preventDefault();
}
const hoverPoint = computed(() => (hovered.value === null ? null : props.data.points[hovered.value]));
// Kept far enough from the edges that the tooltip stays inside the chart.
const tooltipLeft = computed(() => (hoverPoint.value ? Math.min(88, Math.max(12, (x(hoverPoint.value.date) / width) * 100)) : 0));

const summary = computed(() => {
  const p = lastPoint.value;
  if (!p) return '';
  return `${p.done} of ${p.scope} done`;
});
</script>

<template>
  <figure class="burnup viz-root">
    <figcaption>
      <span class="title">Burnup</span>
      <ul class="legend">
        <li><span class="key scope"></span>Scope</li>
        <li><span class="key done"></span>Done</li>
        <li v-if="forecastDrawn"><span class="key forecast"></span>Forecast</li>
        <li v-if="targetDate"><span class="key target"></span>Target</li>
      </ul>
    </figcaption>

    <div class="plot-wrap">
      <svg
        ref="svg"
        :viewBox="`0 0 ${width} ${height}`"
        role="img"
        :aria-label="`Burnup: ${summary}. Use the arrow keys to read each day.`"
        tabindex="0"
        @pointermove="onMove"
        @pointerleave="hovered = null"
        @keydown="onKey"
        @blur="hovered = null"
      >
        <g class="grid">
          <line v-for="t in ticks" :key="t" :x1="pad.left" :x2="pad.left + plotW" :y1="y(t)" :y2="y(t)" />
        </g>
        <g class="axis-text">
          <text v-for="t in ticks" :key="t" :x="pad.left - 6" :y="y(t) + 4" text-anchor="end">{{ t }}</text>
          <text v-for="(label, i) in xLabels" :key="label.date" :x="label.x" :y="height - 8" :text-anchor="i === 0 ? 'start' : 'end'">{{ label.text }}</text>
        </g>
        <line class="baseline" :x1="pad.left" :x2="pad.left + plotW" :y1="y(0)" :y2="y(0)" />

        <g v-if="targetDate && targetDate >= first && targetDate <= end">
          <line class="target" :x1="x(targetDate)" :x2="x(targetDate)" :y1="pad.top" :y2="y(0)" />
          <text class="axis-text" :x="x(targetDate)" :y="pad.top - 4" text-anchor="middle">Target</text>
        </g>

        <path class="line scope" :d="scopePath" />
        <path class="line done" :d="donePath" />
        <line
          v-if="forecastDrawn && lastPoint"
          class="line forecast"
          :x1="x(lastPoint.date)"
          :y1="y(lastPoint.done)"
          :x2="x(forecastDrawn)"
          :y2="y(lastPoint.scope)"
        />

        <!-- Direct labels at today's end of each line. -->
        <template v-if="lastPoint">
          <circle class="dot scope" :cx="x(lastPoint.date)" :cy="y(lastPoint.scope)" r="4" />
          <circle class="dot done" :cx="x(lastPoint.date)" :cy="y(lastPoint.done)" r="4" />
          <text class="end-label" :x="x(lastPoint.date) + 8" :y="y(lastPoint.scope) + (lastPoint.scope - lastPoint.done < top / 10 ? -4 : 4)">
            {{ lastPoint.scope }} scope
          </text>
          <text class="end-label" :x="x(lastPoint.date) + 8" :y="y(lastPoint.done) + (lastPoint.scope - lastPoint.done < top / 10 ? 12 : 4)">
            {{ lastPoint.done }} done
          </text>
        </template>

        <g v-if="hoverPoint">
          <line class="crosshair" :x1="x(hoverPoint.date)" :x2="x(hoverPoint.date)" :y1="pad.top" :y2="y(0)" />
          <circle class="dot scope" :cx="x(hoverPoint.date)" :cy="y(hoverPoint.scope)" r="4" />
          <circle class="dot done" :cx="x(hoverPoint.date)" :cy="y(hoverPoint.done)" r="4" />
        </g>
      </svg>

      <div v-if="hoverPoint" class="tooltip" :style="{ left: `${tooltipLeft}%` }" role="status">
        <div class="tooltip-date">{{ formatDay(hoverPoint.date) }}</div>
        <div><span class="tkey scope"></span><strong>{{ hoverPoint.scope }}</strong> scope</div>
        <div><span class="tkey done"></span><strong>{{ hoverPoint.done }}</strong> done</div>
      </div>
    </div>

    <p class="readout">
      <template v-if="data.forecast">
        At the recent pace ({{ data.pace!.toFixed(data.pace! < 1 ? 2 : 1) }} tickets a day), the open tickets would be done around
        <strong>{{ formatDate(data.forecast) }}</strong><template v-if="targetDate">
          — {{ data.forecast <= targetDate ? 'on track for' : 'after' }} the target of {{ formatDate(targetDate) }}</template
        >.
      </template>
      <template v-else-if="lastPoint && lastPoint.scope > 0 && lastPoint.done >= lastPoint.scope">Everything in this milestone is done.</template>
      <template v-else>No tickets completed recently, so there's no forecast yet.</template>
    </p>

    <details class="table-view">
      <summary>Show as a table</summary>
      <table>
        <thead>
          <tr><th>Day</th><th>Scope</th><th>Done</th></tr>
        </thead>
        <tbody>
          <tr v-for="p in [...data.points].reverse()" :key="p.date">
            <td>{{ formatDay(p.date) }}</td><td>{{ p.scope }}</td><td>{{ p.done }}</td>
          </tr>
        </tbody>
      </table>
    </details>
  </figure>
</template>

<style scoped>
.burnup {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
}

figcaption {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 16px;
}

.title {
  font-weight: 600;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 0.85rem;
}

.legend li {
  display: flex;
  align-items: center;
  gap: 6px;
}

.key,
.tkey {
  display: inline-block;
  width: 16px;
  height: 0;
  border-top: 2px solid;
}

.key.scope,
.tkey.scope {
  border-color: var(--viz-series-1);
}

.key.done,
.tkey.done {
  border-color: var(--viz-series-2);
}

.key.forecast {
  border-top-style: dashed;
  border-color: var(--viz-series-2);
}

.key.target {
  border-top-style: dotted;
  border-color: var(--viz-axis);
}

.plot-wrap {
  position: relative;
}

svg {
  display: block;
  width: 100%;
  height: auto;
  outline: none;
  touch-action: pan-y;
}

svg:focus-visible {
  outline: 2px solid var(--header-hover-color);
  border-radius: 4px;
}

.grid line {
  stroke: var(--viz-grid);
  stroke-width: 1;
}

.baseline {
  stroke: var(--viz-axis);
  stroke-width: 1;
}

.axis-text,
.axis-text text {
  fill: var(--primary-text-color);
  opacity: 0.65;
  font-size: 11px;
}

.target {
  stroke: var(--viz-axis);
  stroke-width: 1.5;
  stroke-dasharray: 2 3;
}

.line {
  fill: none;
  stroke-width: 2;
  stroke-linejoin: round;
}

.line.scope {
  stroke: var(--viz-series-1);
}

.line.done {
  stroke: var(--viz-series-2);
}

.line.forecast {
  stroke: var(--viz-series-2);
  stroke-dasharray: 6 4;
  opacity: 0.8;
}

.dot {
  stroke: var(--tile-background-color);
  stroke-width: 2;
}

.dot.scope {
  fill: var(--viz-series-1);
}

.dot.done {
  fill: var(--viz-series-2);
}

.end-label {
  fill: var(--primary-text-color);
  font-size: 11px;
}

.crosshair {
  stroke: var(--primary-text-color);
  stroke-width: 1;
  opacity: 0.35;
}

.tooltip {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--background-color);
  border: 1px solid rgba(128, 128, 128, 0.4);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  font-size: 0.8rem;
  white-space: nowrap;
  pointer-events: none;
}

.tooltip div {
  display: flex;
  align-items: center;
  gap: 6px;
}

.tooltip-date {
  opacity: 0.7;
}

.readout {
  margin: 0;
  font-size: 0.9rem;
}

.table-view summary {
  cursor: pointer;
  font-size: 0.85rem;
  opacity: 0.8;
}

.table-view table {
  margin-top: 6px;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.table-view th,
.table-view td {
  padding: 2px 12px 2px 0;
  text-align: left;
}

.table-view {
  max-height: 260px;
  overflow-y: auto;
}
</style>
