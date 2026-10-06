<script setup lang="ts">
import { computed } from 'vue';

// A plain horizontal bar chart for the event report: one labeled bar per row,
// all on one scale, with the value written at the end of each bar (so it
// reads on paper, where there's no hovering). A single series: the title says
// what it is.
export interface BarRow {
  label: string;
  // Extra context under the label, e.g. the checklist a step belongs to.
  sub?: string | null;
  value: number;
  // The value as it should read ("12m 30s", "3 repairs").
  text: string;
  // Drawn in the warning color (e.g. a turnaround that cut it close).
  flag?: boolean;
}

const props = defineProps<{ title: string; rows: BarRow[]; hint?: string | null; empty?: string }>();
const longest = computed(() => Math.max(1, ...props.rows.map((row) => row.value)));
</script>

<template>
  <figure class="report-bars viz-root">
    <figcaption>
      <span class="title">{{ title }}</span>
      <span v-if="hint" class="hint">{{ hint }}</span>
    </figcaption>
    <p v-if="!rows.length" class="empty">{{ empty ?? 'No data.' }}</p>
    <ol v-else>
      <li v-for="(row, i) in rows" :key="i">
        <span class="label">
          {{ row.label }} <span v-if="row.sub" class="sub">{{ row.sub }}</span>
        </span>
        <span class="track">
          <span class="bar" :class="{ flag: row.flag }" :style="{ width: `${(Math.max(0, row.value) / longest) * 100}%` }"></span>
          <span class="value">{{ row.text }}</span>
        </span>
      </li>
    </ol>
  </figure>
</template>

<style scoped>
.report-bars {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  margin: 0;
  break-inside: avoid;
}

figcaption {
  display: flex;
  flex-direction: column;
}

.title {
  font-weight: 700;
}

.hint,
.sub {
  font-size: 0.85em;
  opacity: 0.75;
}

.empty {
  margin: 0;
  opacity: 0.7;
}

ol {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

li {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
  align-items: center;
  gap: 10px;
}

.label {
  overflow-wrap: anywhere;
}

.track {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.bar {
  flex: none;
  height: 12px;
  min-width: 2px;
  max-width: calc(100% - 7em);
  border-radius: 0 3px 3px 0;
  background: var(--viz-series-1);
}

.bar.flag {
  background: var(--viz-series-2);
}

.value {
  flex: none;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
