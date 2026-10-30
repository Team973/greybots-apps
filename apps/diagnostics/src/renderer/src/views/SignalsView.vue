<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import '@material/web/button/outlined-button';
import Switch from '@greybots/common/components/Switch.vue';
import TextInput from '@greybots/common/components/TextInput.vue';
import { useViewModeStore } from '@greybots/common/stores/view-mode-store';

import type { SignalLogFile, SignalLogSummary } from '@shared/ipc';
import { describeMatch } from '@shared/offload';
import type { SignalInfo, SignalSeries } from '@shared/signals';
import PlotChart, { type ChartAxis, type ChartLine } from '@/components/PlotChart.vue';
import { formatBytes, formatTime } from '@/format';
import { maxTraces, usePlotStore, type AxisSide, type PlotTarget } from '@/stores/plot-store';

// The reference palette's categorical order, a step per theme, validated
// against the card colours (#fff and #272727). In light mode slots 3, 4 and
// 5 are under 3:1 against white, so every line is also named in the list
// under the chart.
const palette = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']
};

const plotStore = usePlotStore();
const viewMode = useViewModeStore();
const colorOf = (slot: number) => (viewMode.isDarkMode ? palette.dark : palette.light)[slot];

const logs = ref<SignalLogFile[] | null>(null);
const selectedLog = ref('');
const summary = ref<SignalLogSummary | null>(null);
const opening = ref(false);
const openError = ref('');
const message = ref('');

const filter = ref('');
const showEmpty = ref(false);

const signalsByKey = computed(() => new Map((summary.value?.signals ?? []).map((signal) => [signal.key, signal])));
const full = computed<[number, number]>(() => [0, Math.max(summary.value?.duration ?? 1, 0.01)]);
const view = computed<[number, number]>(() => plotStore.view ?? full.value);

// --- The signal list ---

function shown(signal: SignalInfo | undefined): signal is SignalInfo {
  if (!signal || signal.kind === 'other') return false;
  if (!showEmpty.value && signal.count === 0) return false;
  const text = filter.value.trim().toLowerCase();
  return text === '' || signal.key.toLowerCase().includes(text);
}

// --- The signal tree: the signals' own paths, folders and all ---

interface TreeNode {
  name: string;
  path: string;
  signal: SignalInfo | null;
  children: Map<string, TreeNode>;
  count: number;
}

type TreeRow =
  | { type: 'folder'; path: string; name: string; depth: number; count: number; open: boolean }
  | { type: 'signal'; signal: SignalInfo; name: string; depth: number };

// Folders the person has opened (or, for the top level, closed).
const toggled = ref(new Set<string>());

const tree = computed(() => {
  const root: TreeNode = { name: '', path: '', signal: null, children: new Map(), count: 0 };
  for (const signal of summary.value?.signals ?? []) {
    if (!shown(signal)) continue;
    const segments = signal.key.replace(/^NT:/, '').split('/').filter((s) => s !== '');
    let node = root;
    node.count += 1;
    for (const [i, segment] of segments.entries()) {
      let child = node.children.get(segment);
      if (!child) {
        child = { name: segment, path: `${node.path}/${segment}`, signal: null, children: new Map(), count: 0 };
        node.children.set(segment, child);
      }
      child.count += 1;
      if (i === segments.length - 1) child.signal = signal;
      node = child;
    }
  }
  return root;
});

const treeRows = computed<TreeRow[]>(() => {
  const rows: TreeRow[] = [];
  const filtering = filter.value.trim() !== '';
  const byName = (a: TreeNode, b: TreeNode) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

  const visit = (node: TreeNode, depth: number) => {
    const children = [...node.children.values()];
    const folders = children.filter((c) => c.children.size > 0).sort(byName);
    const leaves = children.filter((c) => c.children.size === 0).sort(byName);
    for (const folder of folders) {
      // A folder holding just one folder is shown as one: Robot / robot.
      let shownFolder = folder;
      let name = folder.name;
      while (!shownFolder.signal && shownFolder.children.size === 1) {
        const only = [...shownFolder.children.values()][0];
        if (only.children.size === 0) break;
        shownFolder = only;
        name += ` / ${only.name}`;
      }
      // The top level starts open; everything opens while filtering.
      const open = filtering || (depth === 0 ? !toggled.value.has(shownFolder.path) : toggled.value.has(shownFolder.path));
      rows.push({ type: 'folder', path: shownFolder.path, name, depth, count: shownFolder.count, open });
      if (shownFolder.signal) rows.push({ type: 'signal', signal: shownFolder.signal, name: '(value)', depth: depth + 1 });
      if (open) visit(shownFolder, depth + 1);
    }
    for (const leaf of leaves) if (leaf.signal) rows.push({ type: 'signal', signal: leaf.signal, name: leaf.name, depth });
  };
  visit(tree.value, 0);
  return rows;
});

function toggleFolder(path: string) {
  const next = new Set(toggled.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  toggled.value = next;
}

const withValues = computed(() => (summary.value?.signals ?? []).filter((s) => s.kind !== 'other' && s.count > 0).length);

function signalLabel(signal: SignalInfo): string {
  return signal.subsystem ? `${signal.subsystem} / ${signal.name}` : signal.name;
}

function logLabel(log: SignalLogFile): string {
  const when = formatTime(log.recorded);
  return log.match ? `${describeMatch(log.match)}, ${when}` : `${when} (${log.name})`;
}

// --- Opening a log ---

async function openLog() {
  summary.value = null;
  openError.value = '';
  series.value = new Map();
  plotStore.setView(null);
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

watch(selectedLog, openLog);

// --- Putting signals on the chart ---

function place(signal: SignalInfo, target?: PlotTarget) {
  message.value = plotStore.place(signal.key, signal.kind, target);
}

// Drags carry the signal's key. From the list it's added; from the trace
// list under the chart it's moved.
const dragType = 'application/x-diagnostics-signal';
const dragging = ref(false);
const dropTarget = ref('');

function onDragStart(event: DragEvent, key: string) {
  event.dataTransfer?.setData(dragType, key);
  event.dataTransfer?.setData('text/plain', key);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copyMove';
  dragging.value = true;
}

function onDragEnd() {
  dragging.value = false;
  dropTarget.value = '';
}

function onDragOverZone(event: DragEvent, zone: string) {
  if (!event.dataTransfer?.types.includes(dragType)) return;
  event.preventDefault();
  dropTarget.value = zone;
}

function onDrop(event: DragEvent, target?: PlotTarget) {
  const key = event.dataTransfer?.getData(dragType);
  dragging.value = false;
  dropTarget.value = '';
  const signal = key ? signalsByKey.value.get(key) : undefined;
  if (signal) place(signal, target);
}

const leftAxes = computed(() => plotStore.axes.filter((a) => a.side === 'left'));
const rightAxes = computed(() => plotStore.axes.filter((a) => a.side === 'right'));

function axisUnits(id: string): string {
  const units = plotStore.traces
    .filter((t) => t.axis === id)
    .map((t) => signalsByKey.value.get(t.key)?.unit)
    .filter((u): u is string => !!u);
  return [...new Set(units)].join(', ');
}

function setAxis(key: string, choice: string) {
  const signal = signalsByKey.value.get(key);
  if (!signal) return;
  const target: PlotTarget = choice === 'new-left' || choice === 'new-right'
    ? { newAxis: choice === 'new-left' ? 'left' : 'right' as AxisSide }
    : { axis: choice };
  place(signal, target);
}

// --- Reading what's on the chart ---

const series = shallowRef(new Map<string, SignalSeries | null>());
const plotWidth = ref(800);
let request = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

// Re-read when the signals, the span or the size change: only the span
// shown, at about two points a pixel. Zooming re-reads, so detail appears.
watch(
  () => [summary.value?.localPath, plotStore.traces.map((t) => t.key).join('\n'), view.value[0], view.value[1], plotWidth.value],
  () => {
    clearTimeout(timer);
    timer = setTimeout(readTraces, 60);
  }
);

async function readTraces() {
  const log = summary.value?.localPath;
  if (!log) return;
  const mine = ++request;
  const [start, end] = view.value;
  const keys = plotStore.traces.map((t) => t.key);
  const results = await Promise.all(
    keys.map((key) =>
      signalsByKey.value.has(key)
        ? window.diagnostics.readSignal(log, key, { start, end, maxPoints: Math.ceil(plotWidth.value * 2) })
        : Promise.resolve(null)
    )
  );
  // A newer read has started: this one's out of date.
  if (mine !== request) return;
  series.value = new Map(keys.map((key, i) => [key, results[i]]));
}

const chartAxes = computed<ChartAxis[]>(() =>
  plotStore.axes.map((a) => ({ id: a.id, side: a.side, name: plotStore.axisName(a.id) }))
);

const chartLines = computed<ChartLine[]>(() =>
  plotStore.traces.map((trace) => {
    const signal = signalsByKey.value.get(trace.key);
    return {
      key: trace.key,
      label: signal ? signalLabel(signal) : trace.key,
      unit: signal?.unit ?? '',
      color: colorOf(trace.color),
      axis: trace.axis,
      series: series.value.get(trace.key) ?? null
    };
  })
);

function formatNumber(value: number, unit: string): string {
  const text = Math.abs(value) >= 1000 || value === Math.trunc(value) ? value.toFixed(0) : value.toPrecision(4);
  return unit ? `${text} ${unit}` : text;
}

// --- Zoom ---

function zoomTo(next: [number, number]) {
  const [start, end] = full.value;
  plotStore.setView(next[0] <= start && next[1] >= end ? null : next);
}

function zoomBy(factor: number) {
  const [start, end] = view.value;
  const middle = (start + end) / 2;
  const span = Math.min(full.value[1] - full.value[0], Math.max(0.01, (end - start) * factor));
  let from = middle - span / 2;
  from = Math.max(full.value[0], Math.min(from, full.value[1] - span));
  zoomTo([from, from + span]);
}

onMounted(async () => {
  logs.value = await window.diagnostics.getSignalLogs();
  if (logs.value.length > 0) selectedLog.value = logs.value[0].localPath;
});
</script>

<template>
  <div class="signals-page">
    <aside class="card sidebar">
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
        {{ Math.round(summary.duration) }} s{{ summary.startedAt ? `, from ${formatTime(summary.startedAt)}` : '' }}.
        {{ withValues }} signals with values.
        <template v-if="summary.truncated">The end of the file is cut off.</template>
      </p>
      <p v-for="warning in summary?.warnings ?? []" :key="warning" class="warning-text">{{ warning }}</p>

      <template v-if="summary">
        <TextInput id="signal-filter" :model-value="filter" label="Filter by name" @update:model-value="filter = $event"></TextInput>
        <div class="field-row">
          <span>Show signals with no values</span>
          <Switch id="show-empty-switch" :model-value="showEmpty" @update:model-value="showEmpty = $event"></Switch>
        </div>
        <p class="hint">Drag a signal onto the chart, or click to add it.</p>

        <div class="signal-list" role="tree">
          <p v-if="treeRows.length === 0" class="hint">No signals match.</p>
          <template v-for="row in treeRows" :key="row.type === 'folder' ? `f${row.path}` : `s${row.signal.key}`">
            <button v-if="row.type === 'folder'" class="folder" :style="{ paddingLeft: `${row.depth * 14 + 4}px` }"
              :aria-expanded="row.open" @click="toggleFolder(row.path)">
              <span class="chevron" :class="{ closed: !row.open }">▾</span>
              <span class="signal-name">{{ row.name }}</span>
              <span class="hint small">{{ row.count }}</span>
            </button>
            <div v-else class="signal" draggable="true" :title="row.signal.key"
              :style="{ paddingLeft: `${row.depth * 14 + 20}px` }"
              @dragstart="onDragStart($event, row.signal.key)" @dragend="onDragEnd" @click="place(row.signal)">
              <span class="swatch" :style="{ background: plotStore.trace(row.signal.key) ? colorOf(plotStore.trace(row.signal.key)!.color) : 'transparent' }"></span>
              <span class="signal-name">{{ row.name }}</span>
              <span class="hint small">{{ row.signal.unit }}</span>
            </div>
          </template>
        </div>
      </template>
    </aside>

    <section class="card chart-area">
      <div class="toolbar">
        <md-outlined-button id="zoom-in" :disabled="!summary" @click="zoomBy(0.5)">Zoom in</md-outlined-button>
        <md-outlined-button id="zoom-out" :disabled="!summary || !plotStore.view" @click="zoomBy(2)">Zoom out</md-outlined-button>
        <md-outlined-button id="zoom-all" :disabled="!summary || !plotStore.view" @click="zoomTo(full)">Show all</md-outlined-button>
        <span v-if="summary" id="view-range" class="hint">
          {{ view[0].toFixed(2) }} – {{ view[1].toFixed(2) }} s of {{ full[1].toFixed(0) }} s
        </span>
        <span class="spacer"></span>
        <md-outlined-button v-if="plotStore.traces.length" @click="plotStore.clear()">Clear chart</md-outlined-button>
      </div>
      <p class="hint small">Scroll to zoom, Shift+scroll to pan, drag across the chart to zoom to it, double-click to show all.</p>

      <div class="chart-wrap" @dragover="onDragOverZone($event, 'default')" @drop.prevent="onDrop($event)">
        <PlotChart v-if="summary" :lines="chartLines" :axes="chartAxes" :view="view" :full="full" :height="460"
          @zoom="zoomTo" @width="plotWidth = $event" />
        <div v-if="summary && plotStore.traces.length === 0 && !dragging" class="empty">
          Drag signals here, or click one in the list.
        </div>

        <!-- While dragging: where it can go. -->
        <div v-if="dragging" class="drop-zones">
          <div class="drop-column">
            <div v-for="axis in leftAxes" :key="axis.id" class="drop" :class="{ over: dropTarget === axis.id }"
              @dragover="onDragOverZone($event, axis.id)" @drop.prevent.stop="onDrop($event, { axis: axis.id })">
              {{ plotStore.axisName(axis.id) }} <span class="hint">{{ axisUnits(axis.id) }}</span>
            </div>
            <div class="drop new" :class="{ over: dropTarget === 'new-left' }"
              @dragover="onDragOverZone($event, 'new-left')" @drop.prevent.stop="onDrop($event, { newAxis: 'left' })">
              + New left axis
            </div>
          </div>
          <div class="drop center" :class="{ over: dropTarget === 'default' }"
            @dragover="onDragOverZone($event, 'default')" @drop.prevent.stop="onDrop($event)">
            {{ leftAxes.length ? `Add to ${plotStore.axisName(leftAxes[0].id)}` : 'Add to the chart' }}
            <span class="hint">Text signals go in the bands above the plot.</span>
          </div>
          <div class="drop-column">
            <div v-for="axis in rightAxes" :key="axis.id" class="drop" :class="{ over: dropTarget === axis.id }"
              @dragover="onDragOverZone($event, axis.id)" @drop.prevent.stop="onDrop($event, { axis: axis.id })">
              {{ plotStore.axisName(axis.id) }} <span class="hint">{{ axisUnits(axis.id) }}</span>
            </div>
            <div class="drop new" :class="{ over: dropTarget === 'new-right' }"
              @dragover="onDragOverZone($event, 'new-right')" @drop.prevent.stop="onDrop($event, { newAxis: 'right' })">
              + New right axis
            </div>
          </div>
        </div>
      </div>

      <p v-if="message" class="error-text">{{ message }}</p>

      <table v-if="plotStore.traces.length" id="trace-list" class="plain traces">
        <thead>
          <tr>
            <th></th>
            <th>Signal</th>
            <th>Axis</th>
            <th class="number">Min</th>
            <th class="number">Max</th>
            <th class="number">Mean</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="trace in plotStore.traces" :key="trace.key" draggable="true"
            @dragstart="onDragStart($event, trace.key)" @dragend="onDragEnd">
            <td><span class="swatch" :style="{ background: colorOf(trace.color) }"></span></td>
            <td class="trace-name" :title="trace.key">
              {{ signalsByKey.get(trace.key) ? signalLabel(signalsByKey.get(trace.key)!) : trace.key }}
              <span v-if="!signalsByKey.has(trace.key)" class="hint">(not in this log)</span>
              <span v-else-if="series.get(trace.key)?.times.length === 0" class="hint">(no values here)</span>
            </td>
            <td>
              <span v-if="trace.axis === 'lanes'" class="hint">Band</span>
              <select v-else :value="trace.axis" :aria-label="`Axis for ${trace.key}`" @change="setAxis(trace.key, ($event.target as HTMLSelectElement).value)">
                <option v-for="axis in plotStore.axes" :key="axis.id" :value="axis.id">{{ plotStore.axisName(axis.id) }}</option>
                <option value="new-left">New left axis</option>
                <option value="new-right">New right axis</option>
              </select>
            </td>
            <template v-if="series.get(trace.key)?.stats">
              <td class="number">{{ formatNumber(series.get(trace.key)!.stats!.min, signalsByKey.get(trace.key)?.unit ?? '') }}</td>
              <td class="number">{{ formatNumber(series.get(trace.key)!.stats!.max, signalsByKey.get(trace.key)?.unit ?? '') }}</td>
              <td class="number">{{ formatNumber(series.get(trace.key)!.stats!.mean, signalsByKey.get(trace.key)?.unit ?? '') }}</td>
            </template>
            <template v-else><td></td><td></td><td></td></template>
            <td><button class="remove" :aria-label="`Remove ${trace.key}`" @click="plotStore.remove(trace.key)">✕</button></td>
          </tr>
        </tbody>
      </table>
      <p v-if="plotStore.traces.length" class="hint small">
        Min, max and mean are of the span shown. Up to {{ maxTraces }} signals; drag a row onto the chart to move it to another axis.
      </p>
    </section>
  </div>
</template>

<style scoped>
.signals-page {
  display: grid;
  grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
  gap: 16px;
  width: 100%;
  align-items: start;
}

.signals-page .card {
  max-width: none;
}

.sidebar {
  position: sticky;
  top: 80px;
  max-height: calc(100vh - 112px);
  overflow: hidden;
  gap: 10px;
  padding: 16px;
}

.signal-list {
  overflow-y: auto;
  min-height: 0;
  flex: 1;
  margin: 0 -8px;
  padding: 0 8px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

select {
  padding: 6px 8px;
  border-radius: 6px;
  font: inherit;
  color: inherit;
  background: var(--tile-background-color);
  border: 1px solid rgba(127, 127, 127, 0.6);
}

.folder {
  display: flex;
  width: 100%;
  gap: 4px;
  align-items: center;
  padding: 3px 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 600;
  font-size: 0.9rem;
  text-align: left;
  cursor: pointer;
}

.folder:hover {
  background: rgba(127, 127, 127, 0.12);
}

.chevron {
  display: inline-block;
  width: 12px;
  transition: transform 0.1s;
}

.chevron.closed {
  transform: rotate(-90deg);
}

.signal {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 3px 6px;
  border-radius: 6px;
  font-size: 0.9rem;
  cursor: grab;
}

.signal:hover {
  background: rgba(127, 127, 127, 0.15);
}

.signal-name {
  flex: 1;
  overflow-wrap: anywhere;
}

.small {
  font-size: 0.8rem;
}

.warning-text {
  margin: 0;
  font-size: 0.85rem;
  padding: 6px 8px;
  border-left: 3px solid #fab219;
  background: rgba(250, 178, 25, 0.12);
}

.swatch {
  display: inline-block;
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.chart-area {
  gap: 10px;
  padding: 16px;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.spacer {
  flex: 1;
}

.chart-wrap {
  position: relative;
  min-height: 460px;
}

.empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  opacity: 0.6;
  font-size: 1.1rem;
}

.drop-zones {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: 1fr 2fr 1fr;
  gap: 8px;
}

.drop-column {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.drop {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 2px dashed rgba(127, 127, 127, 0.6);
  border-radius: 10px;
  background: color-mix(in srgb, var(--tile-background-color) 85%, transparent);
  font-weight: 600;
  text-align: center;
  padding: 8px;
}

.drop.new {
  flex: 0 0 auto;
  min-height: 56px;
  font-weight: 500;
}

.drop.over {
  border-color: #2a78d6;
  background: color-mix(in srgb, #2a78d6 15%, var(--tile-background-color));
}

.traces td {
  vertical-align: middle;
}

.traces tr[draggable='true'] {
  cursor: grab;
}

.trace-name {
  overflow-wrap: anywhere;
}

.remove {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0.6;
  font-size: 1rem;
}

.remove:hover {
  opacity: 1;
}
</style>
