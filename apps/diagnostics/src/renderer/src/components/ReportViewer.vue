<script setup lang="ts">
import { computed, reactive } from 'vue';
import { useViewModeStore } from '@greybots/common/stores/view-mode-store';

import { eventKinds, phaseClock, type LogEvent } from '@shared/events';
import type { RenderedSection, Report, ReportLine, ReportPieSlice } from '@shared/library';
import type { SignalSeries } from '@shared/signals';
import PieChart, { sharePercent, type DonutSlice } from '@/components/PieChart.vue';
import PlotChart, { type ChartAxis, type ChartLine } from '@/components/PlotChart.vue';
import { formatTime } from '@/format';
import { colorFor, palette } from '@/palette';
import { eventColor } from '@/review';

// A report as it was made: its charts from the data kept with it, so it
// reads the same whether or not the log is still here. On paper (a PDF),
// in the light theme, sized for the page, kept whole across pages.

const props = defineProps<{ report: Report; paper?: boolean }>();
const viewMode = useViewModeStore();
const dark = computed(() => !props.paper && viewMode.isDarkMode);

function seriesOf(line: ReportLine): SignalSeries {
  return {
    key: line.key,
    kind: line.kind,
    times: Float64Array.from(line.times),
    values: line.kind === 'string' ? (line.values as string[]) : Float64Array.from(line.values as number[]),
    downsampled: false,
    stats: null,
    unit: line.unit
  };
}

// Each chart's lines, axes, and the span shown (zoomable here, not saved).
const charts = computed(() => props.report.sections.map((section) => {
  if (section.type !== 'chart') return null;
  const lines: ChartLine[] = section.lines.map((line) => ({
    key: line.key,
    label: line.label,
    unit: line.unit,
    color: colorFor(line.color, dark.value),
    axis: line.axis,
    band: line.band,
    series: seriesOf(line)
  }));
  const used = section.axes.filter((a) => lines.some((l) => l.axis === a.id));
  const axes: ChartAxis[] = used.map((a) => ({ id: a.id, side: a.side, name: `${a.side === 'left' ? 'L' : 'R'}${used.filter((b) => b.side === a.side).indexOf(a) + 1}` }));
  return { lines, axes };
}));
const views = reactive<Record<number, [number, number]>>({});
const viewOf = (i: number, section: Extract<RenderedSection, { type: 'chart' }>) => views[i] ?? section.view;
function zoom(i: number, section: Extract<RenderedSection, { type: 'chart' }>, next: [number, number], gesture: string) {
  views[i] = gesture === 'all' ? section.view : next;
}

// --- Problems: every error and warning, first ---

const isProblem = (event: LogEvent) => event.severity === 'error' || event.severity === 'warning';
// Reports made before they were kept have them in their events sections.
const problems = computed<LogEvent[]>(() => {
  if (props.report.problems) return props.report.problems;
  const byId = new Map<string, LogEvent>();
  for (const section of props.report.sections) {
    if (section.type === 'events') for (const event of section.events) if (isProblem(event)) byId.set(event.id, event);
  }
  return [...byId.values()].sort((a, b) => a.start - b.start);
});
// So an events section lower down has what's left; one of only problems goes.
const otherEvents = (section: Extract<RenderedSection, { type: 'events' }>) => section.events.filter((e) => !isProblem(e));
const shown = (section: RenderedSection) => section.type !== 'events' || otherEvents(section).length > 0 || !section.events.some(isProblem);

// --- Pies ---

interface PieRow {
  slice: ReportPieSlice;
  color: string;
}

// Largest first. Coloured in the template's order, so a slice keeps its
// colour from report to report. Past the palette's steps, the smallest
// are grey (not cycled), each still a slice of its own.
// The totals are of the slices in the pie (those above zero), so the
// shares add up to 100%.
function pieRows(section: Extract<RenderedSection, { type: 'pie' }>): { rows: PieRow[]; donut: DonutSlice[]; total: number; mean: number; signals: number } {
  const steps = dark.value ? palette.dark : palette.light;
  const other = dark.value ? '#6b6b6b' : '#a3a3a3';
  const positive = section.slices.filter((s) => s.total > 0);
  const kept = positive.length <= steps.length ? positive : [...positive].sort((a, b) => b.total - a.total).slice(0, steps.length - 1);
  const inOrder = section.slices.filter((s) => kept.includes(s));
  const colorOf = (slice: ReportPieSlice) => (kept.includes(slice) ? steps[inOrder.indexOf(slice)] : other);
  const rows = [...section.slices].sort((a, b) => b.total - a.total).map((slice) => ({ slice, color: colorOf(slice) }));
  const donut: DonutSlice[] = rows.filter((r) => r.slice.total > 0)
    .map((r) => ({ label: r.slice.label, value: r.slice.total, color: r.color, note: totalText(section, r.slice) }));
  return {
    rows,
    donut,
    total: positive.reduce((t, s) => t + s.total, 0),
    mean: positive.reduce((t, s) => t + s.mean, 0),
    signals: positive.reduce((t, s) => t + s.keys.length, 0)
  };
}
const pies = computed(() => props.report.sections.map((section) => (section.type === 'pie' ? pieRows(section) : null)));
const hoveredSlice = reactive<Record<number, number | null>>({});
const missingOf = (section: Extract<RenderedSection, { type: 'pie' }>) => section.slices.flatMap((s) => s.missing);
const isEnergy = (section: Extract<RenderedSection, { type: 'pie' }>) => section.measure === 'energy';
// A slice's total: watt-hours of energy, or the average of a current.
function totalText(section: Extract<RenderedSection, { type: 'pie' }>, slice: ReportPieSlice): string {
  return isEnergy(section) ? `${number(slice.total, 'Wh')}` : `${number(slice.mean, section.unit)} on average`;
}

const kindLabel = (kind: string) => eventKinds.find((k) => k.kind === kind)?.label ?? kind;
const number = (value: number | null, unit: string) => {
  if (value === null) return '—';
  const text = Math.abs(value) >= 1000 || value === Math.trunc(value) ? value.toFixed(0) : value.toPrecision(4);
  return unit ? `${text} ${unit}` : text;
};
const at = (t: number) => {
  const clock = phaseClock(props.report.phases, t);
  return clock ? `${t.toFixed(1)} s · ${clock}` : `${t.toFixed(1)} s`;
};
</script>

<template>
  <article class="report" :class="{ paper }">
    <header class="report-head">
      <h2>{{ report.name }}</h2>
      <p class="hint small">
        Run {{ formatTime(report.generated) }} · {{ report.by }} · from the template “{{ report.template.name }}”
      </p>
      <p v-if="report.missing.length" class="warning-text small">
        Not in this log: {{ report.missing.join(', ') }}.
      </p>
    </header>

    <section class="events-section problems">
      <h3 class="heading">Problems <span class="hint small">({{ problems.length }})</span></h3>
      <p v-if="problems.length === 0" class="hint small">No errors or warnings.</p>
      <ul class="events">
        <li v-for="event in problems" :key="event.id" class="event">
          <span class="mark" :style="{ background: eventColor(event, dark) }" :title="event.severity"></span>
          <span class="time small">{{ at(event.start) }}</span>
          <span>
            {{ event.title }}
            <span class="hint small">{{ kindLabel(event.kind) }}{{ event.detail ? ` · ${event.detail}` : '' }}</span>
          </span>
        </li>
      </ul>
    </section>

    <template v-for="(section, i) in report.sections" :key="i">
      <template v-if="!shown(section)"></template>
      <h3 v-else-if="section.type === 'heading'" class="heading">{{ section.text }}</h3>
      <p v-else-if="section.type === 'text'" class="text">{{ section.text }}</p>

      <table v-else-if="section.type === 'summary'" class="plain summary">
        <tbody>
          <tr v-for="fact in section.facts" :key="fact.label">
            <th>{{ fact.label }}</th>
            <td>{{ fact.value }}</td>
          </tr>
        </tbody>
      </table>

      <section v-else-if="section.type === 'chart'" class="chart-section">
        <h4>{{ section.title }}</h4>
        <PlotChart v-if="section.lines.length" :lines="charts[i]!.lines" :axes="charts[i]!.axes" :view="viewOf(i, section)" :full="section.view"
          :height="paper ? 240 : 300" :phases="report.phases" @zoom="(next, gesture) => zoom(i, section, next, gesture)" />
        <p v-else class="hint small">None of this chart's signals are in the log.</p>
        <p class="legend small">
          <span v-for="line in charts[i]!.lines" :key="line.key" class="legend-item">
            <span class="swatch" :style="{ background: line.color }"></span>{{ line.label }}
          </span>
          <span v-if="section.missing.length" class="hint">Missing: {{ section.missing.join(', ') }}</span>
        </p>
      </section>

      <section v-else-if="section.type === 'stats'" class="stats-section">
        <h4>{{ section.title }}</h4>
        <table class="plain">
          <thead>
            <tr><th>Signal</th><th class="number">Min</th><th class="number">Max</th><th class="number">Mean</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in section.rows" :key="row.key">
              <td>{{ row.label }}</td>
              <td class="number">{{ number(row.min, row.unit) }}</td>
              <td class="number">{{ number(row.max, row.unit) }}</td>
              <td class="number">{{ number(row.mean, row.unit) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="section.missing.length" class="hint small">Missing: {{ section.missing.join(', ') }}</p>
      </section>

      <section v-else-if="section.type === 'pie'" class="pie-section">
        <h4>{{ section.title }}</h4>
        <div v-if="pies[i]!.donut.length" class="pie-body">
          <PieChart v-model:hovered="hoveredSlice[i]" :slices="pies[i]!.donut" />
          <table class="plain pie-legend">
            <thead>
              <tr>
                <th></th><th></th><th class="number">Share</th>
                <th v-if="isEnergy(section)" class="number">Energy</th>
                <th class="number">{{ isEnergy(section) ? 'Average power' : 'Average' }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, j) in pies[i]!.rows" :key="row.slice.label" :title="row.slice.keys.join('\n')"
                :class="{ dim: hoveredSlice[i] != null && hoveredSlice[i] !== j }"
                @mouseenter="hoveredSlice[i] = row.slice.total > 0 ? j : null" @mouseleave="hoveredSlice[i] = null">
                <td><span class="swatch" :style="{ background: row.color }"></span></td>
                <td>
                  {{ row.slice.label }}
                  <span v-if="row.slice.keys.length > 1" class="hint small">{{ row.slice.keys.length }} signals</span>
                </td>
                <td class="number">{{ sharePercent(Math.max(0, row.slice.total), pies[i]!.total) || '—' }}</td>
                <td v-if="isEnergy(section)" class="number">{{ row.slice.keys.length ? number(row.slice.total, 'Wh') : '—' }}</td>
                <td class="number">{{ row.slice.keys.length ? number(row.slice.mean, section.unit) : '—' }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="total">
                <td></td>
                <td>Total <span class="hint small">{{ pies[i]!.signals }} signals</span></td>
                <td class="number">100%</td>
                <td v-if="isEnergy(section)" class="number">{{ number(pies[i]!.total, 'Wh') }}</td>
                <td class="number">{{ number(pies[i]!.mean, section.unit) }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p v-else class="hint small">None of this pie's signals are in the log, or they're all zero.</p>
        <p class="hint small">
          <template v-if="isEnergy(section)">
            Shares of the {{ number(pies[i]!.total, 'Wh') }} drawn over {{ section.seconds.toFixed(1) }} s: each signal's voltage times its current,
            added up over time.
          </template>
          <template v-else>Shares of the total over {{ section.seconds.toFixed(1) }} s: each slice's average times the span.</template>
          <template v-if="missingOf(section).length">Missing: {{ missingOf(section).join(', ') }}</template>
        </p>
      </section>

      <section v-else-if="section.type === 'events'" class="events-section">
        <h4>{{ section.title }} <span class="hint small">({{ otherEvents(section).length }})</span></h4>
        <p v-if="otherEvents(section).length === 0" class="hint small">None.</p>
        <ul class="events">
          <li v-for="event in otherEvents(section)" :key="event.id" class="event">
            <span class="mark" :style="{ background: eventColor(event, dark) }" :title="event.severity"></span>
            <span class="time small">{{ at(event.start) }}</span>
            <span>
              {{ event.title }}
              <span class="hint small">{{ kindLabel(event.kind) }}{{ event.detail ? ` · ${event.detail}` : '' }}</span>
            </span>
          </li>
        </ul>
      </section>
    </template>
  </article>
</template>

<style scoped>
.report {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.report-head h2 {
  margin: 0 0 4px;
  font-size: 1.25rem;
}

.small {
  font-size: 0.85rem;
}

.warning-text {
  margin: 4px 0 0;
  color: #c98500;
}

.heading {
  margin: 10px 0 0;
  font-size: 1.1rem;
}

.text {
  margin: 0;
  white-space: pre-wrap;
}

h4 {
  margin: 0 0 6px;
  font-size: 1rem;
}

.summary th {
  width: 140px;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 6px 0 0;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.events {
  margin: 0;
  padding: 0;
  list-style: none;
}

.event {
  display: grid;
  grid-template-columns: 10px 150px minmax(0, 1fr);
  align-items: baseline;
  gap: 10px;
  padding: 4px 0;
  border-bottom: 1px solid rgba(127, 127, 127, 0.15);
}

.mark {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  align-self: center;
}

.time {
  opacity: 0.8;
  font-variant-numeric: tabular-nums;
}

.chart-section,
.stats-section,
.pie-section,
.events-section {
  break-inside: avoid;
}

.pie-body {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
}

.pie-legend {
  flex: 1;
  min-width: 260px;
  width: auto;
}

.pie-legend td {
  padding: 3px 6px;
  vertical-align: middle;
}

.pie-legend .swatch {
  display: inline-block;
}

.pie-legend .total td {
  border-top: 2px solid rgba(127, 127, 127, 0.5);
  font-weight: 600;
}

/* On paper: whole sections on a page where they fit, headings (and the
   text under them) with what follows them, long lists broken between their
   rows; tables ruled lightly, as printed tables are, not shaded like the
   screen's; rows close together. */
.paper {
  gap: 12px;
  font-size: 0.85rem;
}

.paper h3,
.paper h4,
.paper .heading,
.paper .text {
  break-after: avoid;
}

.paper .events-section {
  break-inside: auto;
}

.paper .event,
.paper tr {
  break-inside: avoid;
}

.paper .event {
  padding: 2px 0;
}

.paper :deep(table) {
  box-shadow: none;
  font-family: inherit;
  font-size: 0.8rem;
}

.paper :deep(thead tr) {
  border-bottom: 1.5px solid #000;
  background: none;
  color: #000;
}

.paper :deep(th),
.paper :deep(td) {
  padding: 3px 8px;
}

.paper :deep(tbody tr) {
  border-bottom: 0.5px solid #ccc;
  background: none !important;
}

.paper :deep(tbody tr:last-of-type) {
  border-bottom: 1.5px solid #000;
}

.paper .summary {
  break-inside: avoid;
}

.paper .summary th {
  text-align: left;
  font-weight: 600;
}

.pie-legend .dim {
  opacity: 0.45;
}
</style>
