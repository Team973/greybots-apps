<script setup lang="ts">
import { computed, ref } from 'vue';
import { formatDuration, type Turnaround } from '@/lib/stats/pit-stats';
import { formatTime } from '@/lib/schedule/dates';

// Every turnaround as a stacked bar: post-match, repairs, pre-match, each its
// own segment, all on one time scale so long ones stand out. The legend names
// the stages, the total is written at the end of each bar, hovering a segment
// shows its time, and the same numbers are available as a table.
const props = defineProps<{ turnarounds: Turnaround[] }>();

const stages = [
  { key: 'post', label: 'Post-match' },
  { key: 'repair', label: 'Repairs' },
  { key: 'pre', label: 'Pre-match' }
] as const;

const longest = computed(() => Math.max(1, ...props.turnarounds.map((t) => t.total)));
const name = (t: Turnaround) => (t.matchTitle ? `Before ${t.matchTitle}` : formatTime(t.startedAt));
const hovered = ref<string | null>(null);
const showTable = ref(false);
</script>

<template>
  <figure class="turnarounds viz-root">
    <figcaption>
      <span class="title">Each turnaround, by stage</span>
      <ul class="legend">
        <li v-for="stage in stages" :key="stage.key"><span class="swatch" :class="stage.key"></span>{{ stage.label }}</li>
      </ul>
    </figcaption>

    <p v-if="!turnarounds.length" class="empty">No completed turnarounds yet.</p>
    <template v-else>
      <ol class="rows">
        <li v-for="t in turnarounds" :key="t.key" class="row">
          <span class="name" :title="`In the pit ${formatTime(t.startedAt)}, ready ${formatTime(t.readyAt)}`">{{ name(t) }}</span>
          <span class="track">
            <span class="stack" :style="{ width: `${(t.total / longest) * 100}%` }">
              <template v-for="stage in stages" :key="stage.key">
                <span
                  v-if="t[stage.key] > 0"
                  class="segment"
                  :class="[stage.key, { dim: hovered !== null && hovered !== `${t.key}:${stage.key}` }]"
                  :style="{ flexGrow: t[stage.key] }"
                  tabindex="0"
                  @mouseenter="hovered = `${t.key}:${stage.key}`"
                  @mouseleave="hovered = null"
                  @focus="hovered = `${t.key}:${stage.key}`"
                  @blur="hovered = null"
                >
                  <span v-if="hovered === `${t.key}:${stage.key}`" class="tooltip">{{ stage.label }}: {{ formatDuration(t[stage.key]) }}</span>
                </span>
              </template>
            </span>
            <span class="total">{{ formatDuration(t.total) }}</span>
          </span>
        </li>
      </ol>

      <button class="table-toggle" :aria-expanded="showTable" @click="showTable = !showTable">{{ showTable ? 'Hide' : 'Show' }} as a table</button>
      <div v-if="showTable" class="table-scroll">
        <table>
          <thead>
            <tr><th>Turnaround</th><th>In pit</th><th>Ready</th><th>Post-match</th><th>Repairs</th><th>Pre-match</th><th>Total</th></tr>
          </thead>
          <tbody>
            <tr v-for="t in turnarounds" :key="t.key">
              <td>{{ name(t) }}</td>
              <td>{{ formatTime(t.startedAt) }}</td>
              <td>{{ formatTime(t.readyAt) }}</td>
              <td>{{ formatDuration(t.post) }}</td>
              <td>{{ t.repair ? formatDuration(t.repair) : '—' }}</td>
              <td>{{ formatDuration(t.pre) }}</td>
              <td>{{ formatDuration(t.total) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </figure>
</template>

<style scoped>
.turnarounds {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  margin: 0;
  padding: 14px 16px;
  border-radius: 10px;
  background: var(--tile-background-color);
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
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.swatch {
  width: 12px;
  height: 12px;
  border-radius: 3px;
}

.post {
  background: var(--viz-series-1);
}

.repair {
  background: var(--viz-series-2);
}

.pre {
  background: var(--viz-series-3);
}

.empty {
  margin: 0;
  opacity: 0.6;
}

.rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.row {
  display: grid;
  grid-template-columns: minmax(90px, 150px) minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}

.name {
  font-size: 0.9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.track {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.stack {
  display: flex;
  /* A 2px gap of surface between stacked segments. */
  gap: 2px;
  height: 22px;
  min-width: 4px;
}

.segment {
  position: relative;
  flex-basis: 0;
  min-width: 2px;
  outline: none;
}

/* Rounded at the bar's far end only; the baseline end stays square. */
.segment:last-child {
  border-radius: 0 4px 4px 0;
}

.segment.dim {
  opacity: 0.5;
}

.segment:focus-visible {
  outline: 2px solid var(--primary-text-color);
  outline-offset: 1px;
}

.tooltip {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 50%;
  z-index: 1;
  transform: translateX(-50%);
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--viz-tooltip-bg);
  color: var(--viz-tooltip-fg);
  font-size: 0.8rem;
  white-space: nowrap;
  pointer-events: none;
}

.total {
  flex: none;
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
}

.table-toggle {
  align-self: flex-start;
  padding: 0;
  border: none;
  background: none;
  color: var(--primary-text-color);
  opacity: 0.7;
  font: inherit;
  font-size: 0.85rem;
  text-decoration: underline;
  cursor: pointer;
}

.table-scroll {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}

th,
td {
  padding: 4px 8px;
  text-align: left;
  white-space: nowrap;
}

th {
  font-weight: 600;
  opacity: 0.75;
}
</style>
