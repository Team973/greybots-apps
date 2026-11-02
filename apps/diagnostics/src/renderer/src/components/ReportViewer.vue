<script setup lang="ts">
import { computed, reactive } from 'vue';
import { useViewModeStore } from '@greybots/common/stores/view-mode-store';

import { eventKinds, phaseClock } from '@shared/events';
import type { RenderedSection, Report, ReportLine } from '@shared/library';
import type { SignalSeries } from '@shared/signals';
import PlotChart, { type ChartAxis, type ChartLine } from '@/components/PlotChart.vue';
import { formatTime } from '@/format';
import { colorFor } from '@/palette';
import { eventColor } from '@/review';

// A report as it was made: its charts from the data kept with it, so it
// reads the same whether or not the log is still here.

const props = defineProps<{ report: Report }>();
const viewMode = useViewModeStore();

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
    color: colorFor(line.color, viewMode.isDarkMode),
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
  <article class="report">
    <header class="report-head">
      <h2>{{ report.name }}</h2>
      <p class="hint small">
        Made {{ formatTime(report.generated) }} · {{ report.by }} · from the template “{{ report.template.name }}”
      </p>
      <p v-if="report.missing.length" class="warning-text small">
        Not in this log: {{ report.missing.join(', ') }}. A robot mapping for {{ report.robot || 'this robot' }} can say which signals they are.
      </p>
    </header>

    <template v-for="(section, i) in report.sections" :key="i">
      <h3 v-if="section.type === 'heading'" class="heading">{{ section.text }}</h3>
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
          :height="300" :phases="report.phases" @zoom="(next, gesture) => zoom(i, section, next, gesture)" />
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

      <section v-else-if="section.type === 'events'" class="events-section">
        <h4>{{ section.title }} <span class="hint small">({{ section.events.length }})</span></h4>
        <p v-if="section.events.length === 0" class="hint small">None.</p>
        <ul class="events">
          <li v-for="event in section.events" :key="event.id" class="event">
            <span class="mark" :style="{ background: eventColor(event, viewMode.isDarkMode) }" :title="event.severity"></span>
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
.events-section {
  break-inside: avoid;
}
</style>
