<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import '@material/web/button/outlined-button';
import Switch from '@greybots/common/components/Switch.vue';
import TextInput from '@greybots/common/components/TextInput.vue';

import type { SignalLogFile, SignalLogSummary } from '@shared/ipc';
import { describeMatch } from '@shared/offload';
import type { SignalInfo, SignalSeries } from '@shared/signals';
import SignalChart from '@/components/SignalChart.vue';
import { formatBytes, formatTime } from '@/format';

// More points than the chart is pixels wide add nothing.
const maxPoints = 2000;
// Rows shown in a values table.
const tableRows = 200;

const logs = ref<SignalLogFile[] | null>(null);
const selectedLog = ref('');
const summary = ref<SignalLogSummary | null>(null);
const opening = ref(false);
const openError = ref('');

const view = ref<'groups' | 'subsystems'>('groups');
const filter = ref('');
const showEmpty = ref(false);

const selected = ref<SignalInfo | null>(null);
const series = ref<SignalSeries | null>(null);

const signalsByKey = computed(() => new Map((summary.value?.signals ?? []).map((signal) => [signal.key, signal])));

// What the list shows: plottable signals, with values unless asked, that
// match the filter.
function shown(signal: SignalInfo | undefined): signal is SignalInfo {
  if (!signal || signal.kind === 'other') return false;
  if (!showEmpty.value && signal.count === 0) return false;
  const text = filter.value.trim().toLowerCase();
  return text === '' || signal.key.toLowerCase().includes(text);
}

const groups = computed(() =>
  (summary.value?.groups ?? []).map((group) => ({
    ...group,
    metrics: group.metrics.map((metric) => ({
      name: metric.name,
      signals: metric.keys.map((key) => signalsByKey.value.get(key)).filter(shown)
    }))
  }))
);

const subsystems = computed(() => {
  const bySubsystem = new Map<string, SignalInfo[]>();
  for (const signal of summary.value?.signals ?? []) {
    if (!shown(signal)) continue;
    const name = signal.subsystem || 'Other';
    bySubsystem.set(name, [...(bySubsystem.get(name) ?? []), signal]);
  }
  return [...bySubsystem].sort(([a], [b]) => a.localeCompare(b));
});

const withValues = computed(() => (summary.value?.signals ?? []).filter((s) => s.kind !== 'other' && s.count > 0).length);

function logLabel(log: SignalLogFile): string {
  const when = formatTime(log.recorded);
  return log.match ? `${describeMatch(log.match)}, ${when}` : `${when} (${log.name})`;
}

async function openLog() {
  summary.value = null;
  selected.value = null;
  series.value = null;
  openError.value = '';
  if (!selectedLog.value) return;
  opening.value = true;
  try {
    summary.value = await window.diagnostics.openSignalLog(selectedLog.value);
  } catch (error) {
    openError.value = (error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  } finally {
    opening.value = false;
  }
}

async function select(signal: SignalInfo) {
  selected.value = signal;
  series.value = await window.diagnostics.readSignal(selectedLog.value, signal.key, { maxPoints });
}

function formatNumber(value: number, unit: string): string {
  const text = Math.abs(value) >= 1000 || value === Math.trunc(value) ? value.toFixed(0) : value.toPrecision(4);
  return unit ? `${text} ${unit}` : text;
}

const tableValues = computed(() => {
  const s = series.value;
  if (!s) return [];
  return Array.from({ length: Math.min(tableRows, s.times.length) }, (_, i) => ({
    time: s.times[i].toFixed(3),
    value: s.kind === 'string'
      ? (s.values as string[])[i]
      : s.kind === 'boolean'
        ? String((s.values as Float64Array)[i] === 1)
        : formatNumber((s.values as Float64Array)[i], selected.value?.unit ?? '')
  }));
});

watch(selectedLog, openLog);

onMounted(async () => {
  logs.value = await window.diagnostics.getSignalLogs();
  if (logs.value.length > 0) selectedLog.value = logs.value[0].localPath;
});
</script>

<template>
  <section class="card">
    <h2>Signals</h2>
    <p class="hint">What a WPILib data log recorded, by the robot's own names, sorted into health groups and subsystems.</p>

    <p v-if="logs && logs.length === 0" class="hint">No data logs offloaded yet. They're pulled from the robot on the Logs page.</p>
    <label v-else-if="logs" class="field">
      <span>Log</span>
      <select id="signal-log" v-model="selectedLog">
        <option v-for="log in logs" :key="log.localPath" :value="log.localPath">
          {{ logLabel(log) }} · {{ formatBytes(log.size) }}
        </option>
      </select>
    </label>

    <p v-if="opening" class="hint">Reading the log…</p>
    <p v-if="openError" class="error-text">This log can't be read: {{ openError }}</p>
    <p v-if="summary" id="log-summary" class="hint">
      {{ Math.round(summary.duration) }} s long{{ summary.startedAt ? `, from ${formatTime(summary.startedAt)}` : '' }}.
      {{ withValues }} signals with values, of {{ summary.signals.length }}.
      <template v-if="summary.truncated">The end of the file is cut off.</template>
    </p>
  </section>

  <section v-if="selected" class="card" id="signal-detail">
    <div>
      <h2>{{ selected.name }}</h2>
      <p class="hint path">{{ selected.key }}</p>
    </div>

    <template v-if="series && series.times.length > 0">
      <SignalChart v-if="series.kind !== 'string'" :series="series" :unit="selected.unit" />

      <p v-if="series.stats" id="signal-stats">
        Min <strong>{{ formatNumber(series.stats.min, selected.unit) }}</strong> ·
        Max <strong>{{ formatNumber(series.stats.max, selected.unit) }}</strong> ·
        Mean <strong>{{ formatNumber(series.stats.mean, selected.unit) }}</strong>
        <span class="hint"> · {{ selected.count }} values{{ series.downsampled ? `, ${series.times.length} plotted` : '' }}</span>
      </p>

      <details :open="series.kind === 'string'">
        <summary>Values{{ series.times.length > tableRows ? ` (the first ${tableRows}${series.downsampled ? ' plotted' : ''})` : '' }}</summary>
        <table class="plain">
          <thead>
            <tr>
              <th>Time</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in tableValues" :key="row.time + row.value">
              <td class="number">{{ row.time }} s</td>
              <td class="value">{{ row.value }}</td>
            </tr>
          </tbody>
        </table>
      </details>
    </template>
    <p v-else-if="series" class="hint">No values in this log.</p>
  </section>

  <section v-if="summary" class="card">
    <div class="card-actions">
      <md-outlined-button :class="{ active: view === 'groups' }" @click="view = 'groups'">By health group</md-outlined-button>
      <md-outlined-button :class="{ active: view === 'subsystems' }" @click="view = 'subsystems'">By subsystem</md-outlined-button>
    </div>
    <TextInput id="signal-filter" :model-value="filter" label="Filter by name" @update:model-value="filter = $event"></TextInput>
    <div class="field-row">
      <div>Show signals with no values</div>
      <Switch id="show-empty-switch" :model-value="showEmpty" @update:model-value="showEmpty = $event"></Switch>
    </div>

    <template v-if="view === 'groups'">
      <details v-for="group in groups" :key="group.id" open>
        <summary class="group-title">{{ group.name }}</summary>
        <div v-for="metric in group.metrics" :key="metric.name" class="metric">
          <div class="metric-name">{{ metric.name }}</div>
          <p v-if="metric.signals.length === 0" class="hint">Not in this log.</p>
          <button v-for="signal in metric.signals" :key="signal.key" class="signal"
            :class="{ selected: selected?.key === signal.key }" @click="select(signal)">
            <span class="signal-name">{{ signal.subsystem ? `${signal.subsystem} / ` : '' }}{{ signal.name }}</span>
            <span class="hint">{{ signal.unit }}</span>
            <span class="hint count">{{ signal.count }}</span>
          </button>
        </div>
      </details>
    </template>

    <template v-else>
      <p v-if="subsystems.length === 0" class="hint">No signals match.</p>
      <details v-for="[name, signals] in subsystems" :key="name">
        <summary class="group-title">{{ name }} <span class="hint">({{ signals.length }})</span></summary>
        <button v-for="signal in signals" :key="signal.key" class="signal"
          :class="{ selected: selected?.key === signal.key }" @click="select(signal)">
          <span class="signal-name">{{ signal.name }}</span>
          <span class="hint">{{ signal.unit }}</span>
          <span class="hint count">{{ signal.count }}</span>
        </button>
      </details>
    </template>
  </section>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

select {
  padding: 8px;
  border-radius: 6px;
  font: inherit;
  color: inherit;
  background: var(--tile-background-color);
  border: 1px solid currentColor;
}

md-outlined-button.active {
  --md-outlined-button-outline-width: 2px;
  font-weight: 600;
}

.group-title {
  font-weight: 600;
  cursor: pointer;
  padding: 4px 0;
}

.metric {
  margin: 8px 0 8px 12px;
}

.metric-name {
  opacity: 0.8;
  margin-bottom: 4px;
}

.signal {
  display: flex;
  width: 100%;
  gap: 8px;
  align-items: baseline;
  padding: 4px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.signal:hover,
.signal.selected {
  background: rgba(127, 127, 127, 0.15);
}

.signal-name {
  flex: 1;
  overflow-wrap: anywhere;
}

.count {
  font-variant-numeric: tabular-nums;
}

td.value {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
