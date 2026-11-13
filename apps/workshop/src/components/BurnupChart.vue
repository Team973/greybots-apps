<script setup lang="ts">
import { computed, ref } from 'vue';
import { addDays, formatDay, formatDate, parseDate } from '@/lib/dates';
import type { Burnup, BurnupPoint, Forecast } from '@/lib/milestones';

// A milestone's burnup: scope (tickets meant to get done) and done, day by
// day, as two lines on one count axis. Each visible forecast carries both
// lines on, dashed, to where they meet (marked with the date), or out to a
// horizon when they don't. The target date, if there is one, is a vertical
// marker. Hovering (or arrowing along) shows every value for that day.
// `title` replaces the "Burnup" caption; '' leaves it out (the page has one).
const props = withDefaults(defineProps<{ data: Burnup; targetDate: string | null; title?: string }>(), { title: 'Burnup' });

const width = 640;
const height = 260;
const pad = { top: 22, right: 64, bottom: 28, left: 34 };
const plotW = width - pad.left - pad.right;
const plotH = height - pad.top - pad.bottom;

// A target more than a year out isn't drawn (it would squash the history).
const maxAheadDays = 365;

const first = computed(() => props.data.points[0]?.date ?? '');
const last = computed(() => props.data.points[props.data.points.length - 1]?.date ?? '');
const end = computed(() => {
  let e = last.value;
  for (const f of props.data.forecasts) {
    const d = f.points[f.points.length - 1].date;
    if (d > e) e = d;
  }
  if (props.targetDate && props.targetDate > e && dayIndex(props.targetDate) - dayIndex(last.value) <= maxAheadDays) e = props.targetDate;
  // At least a week wide, so a brand-new milestone isn't a single column.
  return dayIndex(e) - dayIndex(first.value) < 7 ? addDays(first.value, 7) : e;
});

function dayIndex(date: string) {
  return Math.round(parseDate(date).getTime() / 86_400_000);
}
const span = computed(() => Math.max(1, dayIndex(end.value) - dayIndex(first.value)));
const x = (date: string) => pad.left + ((dayIndex(date) - dayIndex(first.value)) / span.value) * plotW;

const maxY = computed(() =>
  Math.max(4, ...props.data.points.map((p) => p.scope), ...props.data.forecasts.flatMap((f) => f.points.map((p) => p.scope)))
);
// Round count ticks: 0, then up to four more.
const ticks = computed(() => {
  const raw = Math.max(1, Math.ceil(maxY.value / 4));
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw)!;
  const out: number[] = [];
  for (let v = 0; v <= maxY.value + step - 1 && out.length < 6; v += step) out.push(v);
  return out;
});
const top = computed(() => ticks.value[ticks.value.length - 1]);
const y = (v: number) => pad.top + plotH - (v / top.value) * plotH;

// Counts change in steps, so the history (and the session forecast, which
// moves a session at a time) is drawn as steps.
function stepPath(pts: BurnupPoint[], key: 'scope' | 'done') {
  if (!pts.length) return '';
  let d = `M${x(pts[0].date)},${y(pts[0][key])}`;
  for (let i = 1; i < pts.length; i++) d += `H${x(pts[i].date)}V${y(pts[i][key])}`;
  return d;
}
function linePath(pts: BurnupPoint[], key: 'scope' | 'done') {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.date)},${y(p[key])}`).join('');
}
const scopePath = computed(() => stepPath(props.data.points, 'scope'));
const donePath = computed(() => stepPath(props.data.points, 'done'));
const lastPoint = computed(() => props.data.points[props.data.points.length - 1]);

const forecastLabel: Record<Forecast['kind'], string> = { plan: 'Plan forecast', sessions: 'Session forecast' };
const projections = computed(() =>
  props.data.forecasts.map((f) => {
    const path = f.stepped ? stepPath : linePath;
    const meet = f.completion ? f.points[f.points.length - 1] : null;
    return {
      kind: f.kind,
      scope: path(f.points, 'scope'),
      done: path(f.points, 'done'),
      meet: meet && { cx: x(meet.date), cy: y(meet.scope), text: formatDay(meet.date) }
    };
  })
);
// Two meeting points close together: one label goes below.
const labelBelow = computed(() => {
  const [a, b] = projections.value.map((p) => p.meet);
  return !!a && !!b && Math.abs(a.cx - b.cx) < 90 && Math.abs(a.cy - b.cy) < 30;
});

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

// --- Words ---
const rate = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(Math.abs(n) < 1 ? 2 : 1));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function describe(f: Forecast): { lead: string; result: string; date: string | null; vsTarget: string } {
  const lead =
    f.kind === 'plan'
      ? `Plan (${rate(f.closedRate)} closed, ${rate(f.openedRate)} opened a week)`
      : `Last ${plural(f.sessionsUsed, 'session', 'sessions')} (${rate(f.closedRate)} closed, ${rate(f.openedRate)} added a session)`;
  if (f.completion) {
    const more = f.kind === 'sessions' ? ` in ${plural(f.points.length - 1, 'more session', 'more sessions')}` : '';
    const vsTarget = props.targetDate ? ` — ${f.completion <= props.targetDate ? 'on track for' : 'after'} the target of ${formatDate(props.targetDate)}` : '';
    return { lead, result: `done around`, date: formatDate(f.completion) + more, vsTarget };
  }
  const result =
    f.closedRate > f.openedRate ? 'the lines don’t meet within a year.' : 'tickets aren’t closing faster than they’re added, so the lines don’t meet.';
  return { lead, result, date: null, vsTarget: '' };
}
const readouts = computed(() => props.data.forecasts.map((f) => ({ kind: f.kind, ...describe(f) })));
const allDone = computed(() => !!lastPoint.value && lastPoint.value.scope > 0 && lastPoint.value.done >= lastPoint.value.scope);

const summary = computed(() => {
  const p = lastPoint.value;
  if (!p) return '';
  const forecasts = readouts.value.map((r) => `${forecastLabel[r.kind]}: ${r.date ? `done around ${r.date}` : 'lines don’t meet'}`);
  return [`${p.done} of ${p.scope} done`, ...forecasts].join('. ');
});
</script>

<template>
  <figure class="burnup viz-root">
    <figcaption>
      <span v-if="title" class="title">{{ title }}</span>
      <ul class="legend">
        <li><span class="key scope"></span>Scope</li>
        <li><span class="key done"></span>Done</li>
        <li v-for="f in data.forecasts" :key="f.kind"><span class="key projected" :class="f.kind"></span>{{ forecastLabel[f.kind] }}</li>
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
          <text class="axis-text" :x="x(targetDate)" :y="pad.top - 8" text-anchor="middle">Target</text>
        </g>

        <path class="line scope" :d="scopePath" />
        <path class="line done" :d="donePath" />

        <g v-for="(p, i) in projections" :key="p.kind" :class="['projection', p.kind]">
          <path class="line scope" :d="p.scope" />
          <path class="line done" :d="p.done" />
          <template v-if="p.meet">
            <circle class="meet" :cx="p.meet.cx" :cy="p.meet.cy" r="5" />
            <text class="meet-label" :x="p.meet.cx" :y="labelBelow && i === 1 ? p.meet.cy + 18 : p.meet.cy - 10" text-anchor="middle">{{ p.meet.text }}</text>
          </template>
        </g>

        <!-- Direct labels at today's end of each line. -->
        <template v-if="lastPoint">
          <circle class="dot scope" :cx="x(lastPoint.date)" :cy="y(lastPoint.scope)" r="4" />
          <circle class="dot done" :cx="x(lastPoint.date)" :cy="y(lastPoint.done)" r="4" />
          <template v-if="!data.forecasts.length">
            <text class="end-label" :x="x(lastPoint.date) + 8" :y="y(lastPoint.scope) + (lastPoint.scope - lastPoint.done < top / 10 ? -4 : 4)">
              {{ lastPoint.scope }} scope
            </text>
            <text class="end-label" :x="x(lastPoint.date) + 8" :y="y(lastPoint.done) + (lastPoint.scope - lastPoint.done < top / 10 ? 12 : 4)">
              {{ lastPoint.done }} done
            </text>
          </template>
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

    <div class="readout">
      <p v-if="allDone">Everything in this milestone is done.</p>
      <p v-for="r in readouts" :key="r.kind">
        <span class="key projected" :class="r.kind"></span>
        {{ r.lead }}:
        <template v-if="r.date">{{ r.result }} <strong>{{ r.date }}</strong>{{ r.vsTarget }}.</template>
        <template v-else>{{ r.result }}</template>
      </p>
      <p v-for="m in data.missing" :key="m.kind" class="muted">{{ forecastLabel[m.kind] }}: {{ m.reason }}</p>
      <p v-if="!allDone && !readouts.length && !data.missing.length && lastPoint && lastPoint.scope > 0" class="muted">No forecast is shown for this milestone.</p>
    </div>
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

/* A forecast's key is in the text color: its dash pattern is what tells the
   two forecasts apart (each draws a scope line and a done line). */
.key.projected {
  border-top-style: dashed;
  border-color: var(--primary-text-color);
  opacity: 0.75;
}

.key.projected.plan {
  border-top-style: dotted;
}

.key.target {
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

.projection .line {
  opacity: 0.85;
}

.projection.sessions .line {
  stroke-dasharray: 7 4;
}

.projection.plan .line {
  stroke-dasharray: 0.5 4;
  stroke-linecap: round;
  stroke-width: 2.5;
}

.meet {
  fill: var(--tile-background-color);
  stroke: var(--primary-text-color);
  stroke-width: 2;
}

.meet-label {
  fill: var(--primary-text-color);
  font-size: 11px;
  font-weight: 600;
  paint-order: stroke;
  stroke: var(--tile-background-color);
  stroke-width: 3px;
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
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.9rem;
}

.readout p {
  margin: 0;
}

.readout .key {
  margin-right: 4px;
  vertical-align: middle;
}
</style>
