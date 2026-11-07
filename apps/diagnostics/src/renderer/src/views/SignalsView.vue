<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSettingsStore } from '@/stores/settings-store';
import '@material/web/button/filled-button';
import '@material/web/button/outlined-button';
import '@material/web/iconbutton/outlined-icon-button';
import AppDialog from '@greybots/common/components/AppDialog.vue';
import Switch from '@greybots/common/components/Switch.vue';
import TextInput from '@greybots/common/components/TextInput.vue';
import { useViewModeStore } from '@greybots/common/stores/view-mode-store';

import { eventKinds, phaseClock, quietKinds, type LogEvent, type SessionEvents } from '@shared/events';
import type { DsLogStatus, HootSessionStatus, SignalLogFile, SignalLogSummary } from '@shared/ipc';
import type { SavedView, ViewBody, ViewSpan } from '@shared/library';
import { isLiveId, isLiveNow, liveKeepSeconds, liveSessions, type EarlierRun, type LiveStatus } from '@shared/live';
import { eventsIn, filesToDelete, filterLogs, noLogFilter, type LogFilter } from '@shared/log-filter';
import { describeMatch } from '@shared/offload';
import { matchKey } from '@shared/signal-match';
import { isPoseType, type PanelType } from '@shared/plots';
import { valueAtTime, type SignalInfo, type SignalKind, type SignalSeries, type SignalValue } from '@shared/signals';
import { chartPng } from '@/chart-image';
import { seasonFor } from '@/fields';
import ColorPicker from '@/components/ColorPicker.vue';
import EventList from '@/components/EventList.vue';
import PlotChart, { type ChartAxis, type ChartLine, type ChartMarker, type ZoomGesture } from '@/components/PlotChart.vue';
import PanelView from '@/components/PanelView.vue';
import PlotTabs from '@/components/PlotTabs.vue';
import ViewsMenu from '@/components/ViewsMenu.vue';
import { formatBytes, formatTime, logCompanions } from '@/format';
import { palette } from '@/palette';
import { eventColor, isProblem, noteEvent, shownEvent, type EventFilter } from '@/review';
import { maxTraces, usePlotStore, type AxisSide, type BandSide, type PlotTarget, type TraceColor } from '@/stores/plot-store';

const plotStore = usePlotStore();
const settingsStore = useSettingsStore();
const viewMode = useViewModeStore();
const themePalette = computed(() => (viewMode.isDarkMode ? palette.dark : palette.light));
// A palette slot takes this theme's step; a colour the person chose is as is.
const colorOf = (color: TraceColor) => (typeof color === 'number' ? themePalette.value[color] : color);

const logs = ref<SignalLogFile[] | null>(null);
const selectedLog = ref('');

// Which logs the picker offers: by event, and only real matches. Kept
// between visits. The open log stays in the list either way.
const logFilterKey = 'signals.logFilter';
function loadLogFilter(): LogFilter {
  try {
    const saved = JSON.parse(localStorage.getItem(logFilterKey) ?? 'null') as Partial<LogFilter> | null;
    return {
      event: typeof saved?.event === 'string' && saved.event ? saved.event : null,
      realMatches: saved?.realMatches === true
    };
  } catch {
    return { ...noLogFilter };
  }
}
const logFilter = ref<LogFilter>(loadLogFilter());
watch(logFilter, (value) => localStorage.setItem(logFilterKey, JSON.stringify(value)), { deep: true });
const logEvents = computed(() => eventsIn(logs.value ?? []));
const filtering = computed(() => !!logFilter.value.event || logFilter.value.realMatches);
const shownLogs = computed(() => {
  const all = logs.value ?? [];
  const shown = filterLogs(all, logFilter.value);
  const open = all.find((log) => log.id === selectedLog.value);
  return open && !shown.includes(open) ? [open, ...shown] : shown;
});
const filterHidesAll = computed(() => filtering.value && (logs.value?.length ?? 0) > 0 && filterLogs(logs.value ?? [], logFilter.value).length === 0);
// Driver Station logs with no data log or Hoot log are listed apart: there
// are many (each time it was open with a robot), and they'd crowd the rest.
const dsOnlyLogs = computed(() => shownLogs.value.filter((log) => !log.localPath && log.hoots.length === 0));
const robotLogs = computed(() => shownLogs.value.filter((log) => log.localPath || log.hoots.length > 0));

// Deleting the open log: its files go to the Recycle Bin, after asking.
const selectedFile = computed(() => logs.value?.find((log) => log.id === selectedLog.value) ?? null);
const deleteOpen = ref(false);
const deleting = ref(false);
const deleteError = ref('');
const toDelete = computed(() => (selectedFile.value ? filesToDelete(selectedFile.value, logs.value ?? []) : { remove: [], kept: [] }));
const fileName = (localPath: string) => localPath.slice(localPath.lastIndexOf('/') + 1);
function askToDelete() {
  deleteError.value = '';
  deleteOpen.value = true;
}
async function deleteSelected() {
  const log = selectedFile.value;
  if (!log) return;
  deleting.value = true;
  deleteError.value = '';
  // The next log down the list (or the one before, at the end) is opened.
  const list = [...robotLogs.value, ...dsOnlyLogs.value];
  const at = list.findIndex((l) => l.id === log.id);
  const next = list[at + 1] ?? list[at - 1] ?? null;
  try {
    await window.diagnostics.deleteLog(log.id);
    deleteOpen.value = false;
    selectedLog.value = next?.id ?? '';
    plotStore.logId = selectedLog.value;
    await loadLogs();
  } catch (error) {
    deleteError.value = (error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  } finally {
    deleting.value = false;
  }
}
const summary = ref<SignalLogSummary | null>(null);
// The moment pinned on the chart: clicked, jumped to, or the playhead.
const pin = ref<number | null>(null);
// A span picked with Shift+drag: min, max and mean are of it, not of the span shown.
const range = ref<[number, number] | null>(null);
const opening = ref(false);
const openError = ref('');
const message = ref('');

const filter = ref('');
const showEmpty = ref(false);

// The sidebar, and the log's details at its top, can be put away to give
// the chart and the signal list more room. Kept between visits.
function storedFlag(key: string, initial: boolean) {
  const flag = ref(localStorage.getItem(key) === null ? initial : localStorage.getItem(key) === 'true');
  watch(flag, (value) => localStorage.setItem(key, String(value)));
  return flag;
}
const sidebarOpen = storedFlag('signals.sidebarOpen', true);
const detailsOpen = storedFlag('signals.detailsOpen', true);
// Runs recorded live and kept (the robot code restarted, or the page was
// left), to plot from after the fact until the app closes.
const earlierRuns = ref<EarlierRun[]>([]);

function runLabel(run: EarlierRun): string {
  const from = liveSessions.find((l) => l.id === run.target)?.label.replace(/^Live: /, '') ?? run.target;
  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `Earlier run from ${from}, ${time(run.startedAt)}–${time(run.endedAt)}`;
}

const selectedLabel = computed(() => {
  const live = liveSessions.find((l) => l.id === selectedLog.value);
  if (live) return live.label;
  const run = earlierRuns.value.find((r) => r.id === selectedLog.value);
  if (run) return runLabel(run);
  const log = logs.value?.find((l) => l.id === selectedLog.value);
  return log ? logLabel(log) : '';
});

// Live: the robot's or a simulator's signals as they change. While
// following, the chart shows the last `liveWindow` seconds up to now (null:
// everything kept); zooming the wheel changes how much. Panning back, or
// dragging across the chart, holds it still until Follow.
const isLive = computed(() => isLiveNow(selectedLog.value));
const liveStatus = ref<LiveStatus | null>(null);
const liveWindow = ref<number | null>(30);
const following = computed(() => isLive.value && plotStore.view === null);

const signalsByKey = computed(() => new Map((summary.value?.signals ?? []).map((signal) => [signal.key, signal])));
// The session's span: Hoot logs often start before the data log, so it
// can start before 0 once they're lined up.
const hootStatus = ref<HootSessionStatus | null>(null);
const full = computed<[number, number]>(() => {
  // Live: as far back as is kept, so the window can be widened before
  // there's that much.
  if (isLive.value) {
    const end = liveStatus.value?.end ?? 0;
    return [Math.min(liveStatus.value?.start ?? 0, end - liveKeepSeconds), Math.max(end, 0.01)];
  }
  const start = hootStatus.value?.start ?? summary.value?.start ?? 0;
  const end = hootStatus.value?.end ?? (summary.value ? (summary.value.start ?? 0) + summary.value.duration : 1);
  return [start, Math.max(end, start + 0.01)];
});
const view = computed<[number, number]>(() => {
  if (plotStore.view) return plotStore.view;
  if (!isLive.value) return full.value;
  const end = full.value[1];
  return [liveWindow.value === null ? Math.min(liveStatus.value?.start ?? 0, end - 1) : end - liveWindow.value, end];
});

// --- The signal list ---

// Structs aren't, but for poses, which the field and the 3D robot show.
function shown(signal: SignalInfo | undefined): signal is SignalInfo {
  if (!signal || (signal.kind === 'other' && !isPoseType(signal.type))) return false;
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
  | { type: 'folder'; path: string; name: string; depth: number; count: number; open: boolean; signal: SignalInfo | null }
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
      rows.push({ type: 'folder', path: shownFolder.path, name, depth, count: shownFolder.count, open, signal: shownFolder.signal });
      const own = shownFolder.signal;
      if (own) rows.push({ type: 'signal', signal: own, name: own.kind === 'other' ? '(pose)' : '(value)', depth: depth + 1 });
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
  const what = log.match ? `${describeMatch(log.match)}, ${when}` : `${when} (${log.name})`;
  return `${what}${logCompanions(log)}`;
}

function describeDsLog(ds: DsLogStatus): string {
  const offset = `${ds.offset >= 0 ? '+' : ''}${ds.offset.toFixed(2)} s`;
  const placed = ds.alignment === 'base' ? 'the timeline'
    : ds.alignment === 'enable' ? `lined up by the first enable (${offset})`
      : `lined up by the clocks (${offset}), which can be a second or so out`;
  return [placed, ds.match ? `FMS: ${ds.match}` : '', ds.truncated ? 'the end is cut off' : ''].filter(Boolean).join('; ');
}

// The unit, from the catalog or, for a Hoot signal, from its first read.
function unitOf(key: string): string {
  return signalsByKey.value.get(key)?.unit || series.value.get(key)?.unit || '';
}

function describeAlignment(hoot: HootSessionStatus['hoots'][number]): string {
  if (hoot.offset === null) return '';
  const offset = `${hoot.offset >= 0 ? '+' : ''}${hoot.offset.toFixed(2)} s`;
  if (hoot.alignment === 'enable') return `lined up by the first enable (${offset})`;
  if (hoot.alignment === 'name') return `lined up by the file names' times, to the second (${offset})`;
  return 'the timeline';
}

// --- Opening a log ---

async function openLog() {
  pause();
  pin.value = null;
  range.value = null;
  review.value = null;
  selectedEvent.value = null;
  clearTimeout(eventsTimer);
  summary.value = null;
  hootStatus.value = null;
  liveStatus.value = null;
  clearTimeout(liveTimer);
  openError.value = '';
  series.value = new Map();
  // Back to the log the chart was last on (another page, or the app opened
  // again): as it was left. Live follows again.
  if (isLive.value || plotStore.logId !== selectedLog.value) plotStore.setView(null);
  if (!selectedLog.value) return;
  plotStore.logId = selectedLog.value;
  opening.value = true;
  try {
    summary.value = await window.diagnostics.openSignalLog(selectedLog.value);
    if (isLive.value) pollLive();
    if (logs.value?.find((log) => log.id === selectedLog.value)?.hoots.length) pollHoots();
    loadEvents();
  } catch (error) {
    openError.value = (error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  } finally {
    opening.value = false;
  }
}

watch(selectedLog, openLog);

// While Hoot logs are being lined up, or signals extracted from them, the
// window asks how it's going.
let hootTimer: ReturnType<typeof setTimeout> | undefined;
async function pollHoots() {
  clearTimeout(hootTimer);
  const id = summary.value?.id;
  if (!id) return;
  const status = await window.diagnostics.getHootStatus(id);
  if (summary.value?.id !== id) return;
  hootStatus.value = status;
  const busy = status.progress !== null || status.hoots.some((hoot) => hoot.state === 'opening') || reading.value;
  if (busy) hootTimer = setTimeout(pollHoots, 500);
}
onUnmounted(() => clearTimeout(hootTimer));

// Live: ten times a second, how far the timeline goes (which moves the
// chart along) and whether it's connected. Signals turn up as the robot
// code first logs them, so the list is looked at again every few seconds.
const livePollMs = 100;
const liveCatalogMs = 2000;
let liveTimer: ReturnType<typeof setTimeout> | undefined;
let catalogAt = 0;
async function pollLive() {
  clearTimeout(liveTimer);
  const id = selectedLog.value;
  if (!isLiveNow(id)) return;
  try {
    const status = await window.diagnostics.getLiveStatus(id);
    if (selectedLog.value !== id) return;
    if (status.earlierRuns !== earlierRuns.value.length) earlierRuns.value = await window.diagnostics.getEarlierRuns();
    liveStatus.value = status;
    if (status.signals !== summary.value?.signals.length || Date.now() - catalogAt > liveCatalogMs) {
      catalogAt = Date.now();
      const next = await window.diagnostics.openSignalLog(id);
      if (selectedLog.value === id) summary.value = next;
    }
  } finally {
    if (selectedLog.value === id) liveTimer = setTimeout(pollLive, livePollMs);
  }
}
onUnmounted(() => clearTimeout(liveTimer));

function describeLive(status: LiveStatus | null): string {
  if (!status || status.state === 'connecting') return 'Connecting…';
  if (status.state === 'connected') return `Connected to ${status.host}`;
  return 'Not connected';
}

// --- Putting signals on the chart ---

// With another plot's tab shown, a clicked signal goes to that plot.
const panelView = ref<{ add: (signal: SignalInfo) => void } | null>(null);
function place(signal: SignalInfo, target?: PlotTarget) {
  if (!target && panelView.value) {
    message.value = '';
    panelView.value.add(signal);
  } else if (signal.kind === 'other') {
    message.value = 'Poses show on a 2D field or the 3D robot: open one with + above the chart, then click or drag the pose there.';
  } else {
    message.value = plotStore.place(signal.key, signal.kind, target);
  }
}

// Drags carry the signal's key. From the list it's added; from the trace
// list under the chart it's moved.
const dragType = 'application/x-diagnostics-signal';
const dragging = ref(false);
// Text signals go to a band, so their drop zones are the two bands.
const draggingText = ref(false);
const dropTarget = ref('');

function onDragStart(event: DragEvent, key: string) {
  event.dataTransfer?.setData(dragType, key);
  event.dataTransfer?.setData('text/plain', key);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copyMove';
  dragging.value = true;
  draggingText.value = (signalsByKey.value.get(key)?.kind ?? plotStore.trace(key)?.kind) === 'string';
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

// Out of the chart altogether: nothing's highlighted.
function onDragLeaveChart(event: DragEvent) {
  const into = event.relatedTarget as Node | null;
  if (!into || !(event.currentTarget as HTMLElement).contains(into)) dropTarget.value = '';
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
    .map((t) => unitOf(t.key))
    .filter((u): u is string => !!u);
  return [...new Set(units)].join(', ');
}

// The trace list's Axis choice: an axis, a new one, or a band.
function setAxis(key: string, choice: string) {
  const trace = plotStore.trace(key);
  if (!trace) return;
  const target: PlotTarget = choice === 'new-left' || choice === 'new-right'
    ? { newAxis: choice === 'new-left' ? 'left' : 'right' as AxisSide }
    : choice === 'band-top' || choice === 'band-bottom'
      ? { band: choice.slice(5) as BandSide }
      : { axis: choice };
  message.value = plotStore.place(key, trace.kind, target);
}

// --- Reading what's on the chart ---

const series = shallowRef(new Map<string, SignalSeries | null>());
const plotWidth = ref(800);
let request = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

// Re-read when the signals, the span or the size change: only the span
// shown, at about two points a pixel. Zooming re-reads, so detail appears.
// Each value is watched on its own: a status poll that changes nothing
// mustn't start a new read (that would throw away a slow Hoot export).
watch(
  [() => summary.value?.id, () => plotStore.traces.map((t) => t.key).join('\n'), () => view.value[0], () => view.value[1], plotWidth],
  () => {
    clearTimeout(timer);
    timer = setTimeout(readTraces, 60);
  }
);

const reading = ref(false);
const readError = ref('');

async function readTraces() {
  const log = summary.value?.id;
  if (!log) return;
  const mine = ++request;
  const [start, end] = view.value;
  const keys = plotStore.traces.map((t) => t.key);
  reading.value = true;
  if (hootStatus.value) pollHoots();
  const errors: string[] = [];
  const results = await Promise.all(
    keys.map((key) =>
      signalsByKey.value.has(key)
        ? window.diagnostics.readSignal(log, key, { start, end, maxPoints: Math.ceil(plotWidth.value * 2) }).catch((error: Error) => {
          errors.push(error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
          return null;
        })
        : Promise.resolve(null)
    )
  );
  // A newer read has started: this one's out of date.
  if (mine !== request) return;
  reading.value = false;
  readError.value = [...new Set(errors)].join(' ');
  series.value = new Map(keys.map((key, i) => [key, results[i]]));
  // A Hoot signal's type is only known once read: a text one goes to the
  // bands, a number guessed as text to an axis.
  for (const [i, key] of keys.entries()) {
    const kind = results[i]?.kind;
    if (kind && kind !== 'other' && kind !== plotStore.trace(key)?.kind) plotStore.setKind(key, kind);
  }
}

// Hidden signals stay listed (with their values) but are off the chart, and
// so is an axis with only hidden signals on it. Axes keep their names.
const shownTraces = computed(() => plotStore.traces.filter((t) => !t.hidden));

const chartAxes = computed<ChartAxis[]>(() =>
  plotStore.axes
    .filter((a) => shownTraces.value.some((t) => t.axis === a.id))
    .map((a) => ({ id: a.id, side: a.side, name: plotStore.axisName(a.id) }))
);

const chartLines = computed<ChartLine[]>(() =>
  shownTraces.value.map((trace) => {
    const signal = signalsByKey.value.get(trace.key);
    return {
      key: trace.key,
      label: signal ? signalLabel(signal) : trace.key,
      unit: unitOf(trace.key),
      color: colorOf(trace.color),
      axis: trace.axis,
      band: trace.band,
      series: series.value.get(trace.key) ?? null
    };
  })
);

// The list under the chart shows four signals, then scrolls. Measured, as
// a long name wraps its row.
const traceRowsShown = 4;
const traceBox = ref<HTMLElement | null>(null);
const traceBoxHeight = ref<number | null>(null);
function fitTraceList() {
  const table = traceBox.value?.querySelector('table');
  if (!table) return;
  const rows = [...table.querySelectorAll('tbody tr')] as HTMLElement[];
  if (rows.length <= traceRowsShown) {
    traceBoxHeight.value = null;
    return;
  }
  // From the table's top to the last row shown's bottom, borders and all.
  traceBoxHeight.value = Math.ceil(rows[traceRowsShown - 1].getBoundingClientRect().bottom - table.getBoundingClientRect().top);
}
let traceObserver: ResizeObserver | undefined;
watch(traceBox, (box) => {
  traceObserver?.disconnect();
  const table = box?.querySelector('table');
  if (!table) return;
  traceObserver = new ResizeObserver(fitTraceList);
  traceObserver.observe(table);
}, { flush: 'post' });
onUnmounted(() => traceObserver?.disconnect());

function formatNumber(value: number, unit: string): string {
  const text = Math.abs(value) >= 1000 || value === Math.trunc(value) ? value.toFixed(0) : value.toPrecision(4);
  return unit ? `${text} ${unit}` : text;
}

function formatValue(value: SignalValue, kind: SignalKind | undefined, unit: string): string {
  if (value === null) return '—';
  if (typeof value === 'string') return value;
  if (kind === 'boolean') return value ? 'true' : 'false';
  return formatNumber(value, unit);
}

// --- Values: the latest while following live, otherwise at the right edge
// of the span shown ---

// Or at the pin (or the playhead), when there is one.
const valueTime = computed(() => (!following.value && pin.value !== null ? pin.value : view.value[1]));
const valueHeading = computed(() => (following.value ? 'Now' : `At ${valueTime.value.toFixed(2)} s`));

// The list under the chart: each signal's value, and whichever of its
// stats over the span shown the person adds. Kept between visits.
type Column = 'value' | 'min' | 'max' | 'mean';
const columnChoices: { id: Column; label: string }[] = [
  { id: 'value', label: 'Value' },
  { id: 'min', label: 'Min' },
  { id: 'max', label: 'Max' },
  { id: 'mean', label: 'Mean' }
];
function storedColumns(): Column[] {
  try {
    const saved = JSON.parse(localStorage.getItem('signals.columns') ?? 'null') as Column[] | null;
    if (Array.isArray(saved)) return columnChoices.map((c) => c.id).filter((id) => saved.includes(id));
  } catch {
    // Fall through to the default.
  }
  return ['value'];
}
const columns = ref<Column[]>(storedColumns());
watch(columns, (value) => localStorage.setItem('signals.columns', JSON.stringify(value)));
function toggleColumn(id: Column) {
  const next = columns.value.includes(id) ? columns.value.filter((c) => c !== id) : [...columns.value, id];
  columns.value = columnChoices.map((c) => c.id).filter((c) => next.includes(c));
}
const showsStats = computed(() => columns.value.some((c) => c !== 'value'));

// Stats over the range picked, read for it (at full detail: they're of every
// value in it, whatever's drawn).
const rangeStats = shallowRef(new Map<string, SignalSeries['stats']>());
let rangeRequest = 0;
async function readRangeStats() {
  const log = summary.value?.id;
  const picked = range.value;
  const mine = ++rangeRequest;
  if (!log || !picked) {
    rangeStats.value = new Map();
    return;
  }
  const keys = plotStore.traces.map((t) => t.key).filter((key) => signalsByKey.value.has(key));
  const results = await Promise.all(keys.map((key) =>
    window.diagnostics.readSignal(log, key, { start: picked[0], end: picked[1], maxPoints: 2 }).catch(() => null)));
  if (mine === rangeRequest) rangeStats.value = new Map(keys.map((key, i) => [key, results[i]?.stats ?? null]));
}
watch([range, () => summary.value?.id, () => plotStore.traces.map((t) => t.key).join('\n')], readRangeStats);
// Picking a range is asking for its stats: they're shown if they weren't.
watch(range, (picked) => {
  if (picked && !showsStats.value) columns.value = columnChoices.map((c) => c.id);
});

function cell(key: string, column: Column): string {
  const line = series.value.get(key);
  if (!line) return '';
  const unit = unitOf(key);
  if (column === 'value') return formatValue(valueAtTime(line, valueTime.value), line.kind, unit);
  const stats = range.value ? rangeStats.value.get(key) : line.stats;
  return stats ? formatNumber(stats[column], unit) : '';
}

// The signal list: each signal shown gets its value too. Asked of the
// main process for just the rows on screen, a few times a second at most.
const leafValues = shallowRef(new Map<string, SignalValue>());
const shownLeaves = computed(() =>
  treeRows.value.flatMap((row) => (row.type === 'signal' && row.signal.kind !== 'other' ? [row.signal.key] : [])).slice(0, 500)
);
const valuesEveryMs = 250;
let valuesTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleValues() {
  valuesTimer ??= setTimeout(readLeafValues, valuesEveryMs);
}
async function readLeafValues() {
  valuesTimer = undefined;
  const id = summary.value?.id;
  const keys = shownLeaves.value;
  if (!id || keys.length === 0) return;
  const result = await window.diagnostics.readValues(id, [...keys], valueTime.value).catch(() => null);
  if (result && summary.value?.id === id) leafValues.value = new Map(Object.entries(result));
}
watch([() => summary.value?.id, () => shownLeaves.value.join('\n'), valueTime], scheduleValues);
onUnmounted(() => clearTimeout(valuesTimer));

function leafText(signal: SignalInfo): string {
  const value = leafValues.value.get(signal.key);
  if (value === undefined || value === null) return signal.unit;
  return formatValue(value, signal.kind, signal.unit);
}

// --- Zoom ---

function zoomTo(next: [number, number], gesture?: ZoomGesture) {
  const [start, end] = full.value;
  if (isLive.value) {
    const span = next[1] - next[0];
    if (gesture === 'all') {
      liveWindow.value = null;
      plotStore.setView(null);
    } else if ((following.value && gesture === 'wheel') || (gesture === 'pan' && next[1] >= end - span * 0.01)) {
      // Still up to now: keep following, showing this much.
      liveWindow.value = span;
      plotStore.setView(null);
    } else {
      plotStore.setView(next);
    }
    return;
  }
  plotStore.setView(next[0] <= start && next[1] >= end ? null : next);
}

// Copying the chart as an image, to paste into a PR or a message: a caption
// saying what it's of, the chart with its pinned readout, and a legend of
// every signal with its value. Drawn off screen (chart-image.ts), so the
// page doesn't change while it's made.
const copying = ref(false);
const copyState = ref<'idle' | 'copied' | string>('idle');
const chartElement = ref<InstanceType<typeof PlotChart> | null>(null);
let copyTimer: ReturnType<typeof setTimeout> | undefined;

const captureCaption = computed(() => {
  const span = following.value
    ? `${liveWindow.value === null ? 'everything kept' : `the last ${formatSpan(liveWindow.value)}`}, live`
    : `${view.value[0].toFixed(2)} – ${view.value[1].toFixed(2)} s`;
  return `${selectedLabel.value} · ${span}`;
});

async function copyImage() {
  const snapshot = chartElement.value?.snapshot();
  if (!snapshot) return;
  copying.value = true;
  try {
    const legend = shownTraces.value.map((trace) => {
      const signal = signalsByKey.value.get(trace.key);
      return {
        color: colorOf(trace.color),
        label: signal ? signalLabel(signal) : trace.key,
        note: trace.axis === 'lanes' ? `(${trace.band} band)` : plotStore.axes.length > 1 ? `(${plotStore.axisName(trace.axis)})` : '',
        value: cell(trace.key, 'value')
      };
    });
    if (legend.length) legend.push({ color: 'transparent', label: following.value ? 'Values latest' : `Values at ${view.value[1].toFixed(2)} s`, note: '', value: '' });
    const card = getComputedStyle(snapshot.svg.closest('.card') ?? document.body);
    const png = await chartPng(snapshot, {
      caption: captureCaption.value,
      legend,
      background: card.backgroundColor,
      text: card.color,
      fontFamily: card.fontFamily
    });
    const problem = await window.diagnostics.copyImage(png);
    copyState.value = problem || 'copied';
  } catch (error) {
    copyState.value = (error as Error).message;
  } finally {
    copying.value = false;
  }
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { copyState.value = 'idle'; }, 2500);
}
onUnmounted(() => clearTimeout(copyTimer));

function formatSpan(seconds: number): string {
  if (seconds >= 120) return `${Number((seconds / 60).toFixed(1))} min`;
  return `${Number(seconds.toPrecision(seconds < 10 ? 2 : 3))} s`;
}

function follow() {
  plotStore.setView(null);
}

function zoomBy(factor: number) {
  if (following.value) {
    const span = (liveWindow.value ?? view.value[1] - view.value[0]) * factor;
    liveWindow.value = Math.min(liveKeepSeconds, Math.max(0.5, span));
    return;
  }
  const [start, end] = view.value;
  const middle = (start + end) / 2;
  const span = Math.min(full.value[1] - full.value[0], Math.max(0.01, (end - start) * factor));
  let from = middle - span / 2;
  from = Math.max(full.value[0], Math.min(from, full.value[1] - span));
  zoomTo([from, from + span]);
}

// --- Saved views (#148) ---

// Signals a view's can be found among: those with values (poses and all,
// for the other plots).
const viewSignals = computed(() => (summary.value?.signals ?? []).filter((s) => s.count !== 0).map((s) => s.key));
const selectedRobot = computed(() => (logs.value ?? []).find((log) => log.id === selectedLog.value)?.robot ?? '');

function currentView(span: ViewSpan): ViewBody {
  return plotStore.viewBody(span, eventFilter.value.kinds);
}

function applySavedView(view: SavedView, mapping: Record<string, string | null> | undefined) {
  const missing = plotStore.applyView(view, (key) => matchKey(key, viewSignals.value, mapping).key);
  if (view.eventKinds) eventFilter.value = { ...eventFilter.value, kinds: view.eventKinds };
  // Its span, when this log has that phase.
  if (view.span.type === 'phase' && review.value && !isLive.value) {
    const phases = review.value.phases;
    const wanted = view.span.phase === 'match' ? phases : phases.filter((p) => p.name === (view.span as { phase: string }).phase);
    if (wanted.length) zoomTo([Math.min(...wanted.map((p) => p.start)), Math.max(...wanted.map((p) => p.end))]);
  } else if (view.span.type === 'all' && !isLive.value) {
    plotStore.setView(null);
  }
  message.value = missing.length
    ? `${view.name}: ${missing.length} of its signals aren't here (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', …' : ''}). A robot mapping on the Reports page can say which they are.`
    : '';
}

// --- Review (#94): events, the match's phases, notes, and playing back ---

const review = ref<SessionEvents | null>(null);
const selectedEvent = ref<string | null>(null);

// Which kinds of event show, on the chart and in the list. Kept between visits.
function storedFilter(): EventFilter {
  const all = eventKinds.map((k) => k.kind);
  try {
    const saved = JSON.parse(localStorage.getItem('signals.eventFilter') ?? 'null') as EventFilter | null;
    if (saved && Array.isArray(saved.kinds)) return { kinds: all.filter((k) => saved.kinds.includes(k)), routine: !!saved.routine };
  } catch {
    // Fall through to everything but the routine.
  }
  // State changes and button presses are many: only once picked.
  return { kinds: all.filter((k) => !quietKinds.includes(k)), routine: false };
}
const eventFilter = ref<EventFilter>(storedFilter());
watch(eventFilter, (value) => localStorage.setItem('signals.eventFilter', JSON.stringify(value)));

const allEvents = computed<LogEvent[]>(() =>
  review.value ? [...review.value.events, ...review.value.notes.map(noteEvent)].sort((a, b) => a.start - b.start) : []
);
const shownEvents = computed(() => allEvents.value.filter((e) => shownEvent(e, eventFilter.value)));
const markers = computed<ChartMarker[]>(() => shownEvents.value.map((e) => ({
  id: e.id,
  start: e.start,
  end: e.end,
  color: eventColor(e, viewMode.isDarkMode),
  title: e.detail ? `${e.title} (${e.detail})` : e.title
})));

// Events are found when a log's opened; device faults in Hoot logs take a
// little longer (owlet exports them first), so it's asked again until done.
let eventsTimer: ReturnType<typeof setTimeout> | undefined;
async function loadEvents() {
  clearTimeout(eventsTimer);
  const id = summary.value?.id;
  if (!id || isLiveId(id)) return;
  try {
    const found = await window.diagnostics.getEvents(id);
    if (summary.value?.id !== id) return;
    review.value = found;
    if (found.pending) eventsTimer = setTimeout(loadEvents, 1500);
  } catch (error) {
    message.value = (error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  }
}
onUnmounted(() => clearTimeout(eventsTimer));

// Brings a time (and as much of what lasts from it as fits) into view,
// leaving the span shown as it was if it's there already.
function showTime(start: number, end: number | null = null) {
  const [from, to] = view.value;
  const until = end ?? start;
  if (start >= from && until <= to) return;
  const [fullStart, fullEnd] = full.value;
  const span = Math.min(fullEnd - fullStart, Math.max(to - from, (until - start) * 1.25));
  const left = Math.max(fullStart, Math.min(start - span * 0.2, fullEnd - span));
  zoomTo([left, left + span]);
}

function selectEvent(event: LogEvent) {
  selectedEvent.value = event.id;
  pin.value = event.start;
  showTime(event.start, event.end);
}

function onMarker(id: string) {
  const event = allEvents.value.find((e) => e.id === id);
  if (event) selectEvent(event);
}

// The next (or previous) error or warning from the one picked or the pin;
// with neither, the first (or last) in the span shown.
function stepProblem(direction: 1 | -1) {
  const edge = direction === 1 ? view.value[0] - 1e-3 : view.value[1] + 1e-3;
  const from = allEvents.value.find((e) => e.id === selectedEvent.value)?.start ?? pin.value ?? edge;
  const problems = shownEvents.value.filter(isProblem);
  const next = direction === 1 ? problems.find((e) => e.start > from + 1e-6) : [...problems].reverse().find((e) => e.start < from - 1e-6);
  if (next) selectEvent(next);
}

const canNote = computed(() => !!summary.value && !isLiveId(summary.value.id));
const noteTime = computed(() => pin.value ?? (view.value[0] + view.value[1]) / 2);

async function saveNote(note: { id?: string; time: number; text: string }) {
  const id = summary.value?.id;
  if (!id || !review.value) return;
  try {
    // A plain copy: the editor's is reactive, which IPC can't send.
    const plain = { ...(note.id ? { id: note.id } : {}), time: note.time, text: note.text };
    review.value = { ...review.value, notes: await window.diagnostics.saveNote(id, plain) };
  } catch (error) {
    message.value = (error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  }
}

async function deleteNote(noteId: string) {
  const id = summary.value?.id;
  if (!id || !review.value) return;
  try {
    review.value = { ...review.value, notes: await window.diagnostics.deleteNote(id, noteId) };
  } catch (error) {
    message.value = (error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  }
}

// Playing back: the pin moves through the log as it happened (or faster),
// and the span shown moves along to keep it in sight.
const speeds = [0.25, 0.5, 1, 2, 4, 8];
const speed = ref(1);
const playing = ref(false);
let frame = 0;
let lastFrame = 0;

function play() {
  if (!summary.value || isLive.value) return;
  const [start, end] = full.value;
  if (pin.value === null || pin.value >= end - 1e-3) pin.value = pin.value === null ? Math.max(start, view.value[0]) : start;
  showTime(pin.value);
  playing.value = true;
  lastFrame = performance.now();
  frame = requestAnimationFrame(advance);
}

function pause() {
  playing.value = false;
  cancelAnimationFrame(frame);
}

function advance(now: number) {
  if (!playing.value || pin.value === null) return;
  const end = full.value[1];
  const t = Math.min(end, pin.value + ((now - lastFrame) / 1000) * speed.value);
  lastFrame = now;
  pin.value = t;
  const [from, to] = view.value;
  const span = to - from;
  if (t > to - span * 0.02 || t < from) {
    const left = Math.max(full.value[0], Math.min(t - span * 0.1, end - span));
    zoomTo([left, left + span]);
  }
  if (t >= end) pause();
  else frame = requestAnimationFrame(advance);
}
onUnmounted(pause);

// The other plots' season: the log's, by when it was recorded.
const season = computed(() => seasonFor(summary.value?.startedAt ?? logs.value?.find((l) => l.id === selectedLog.value)?.recorded));

// The tab shown: the line chart, or another plot (#144).
const shownPanel = computed(() => plotStore.panels.find((p) => p.id === plotStore.activeTab) ?? null);
const onLine = computed(() => shownPanel.value === null);
const chartHeight = 460;

function addPlot(type: PanelType) {
  message.value = plotStore.addPanel(type, season.value);
}

// A moment picked in another plot (a console line).
function seek(time: number) {
  pin.value = time;
  showTime(time);
}

function scrub(event: Event) {
  pin.value = Number((event.target as HTMLInputElement).value);
  showTime(pin.value);
}

// Space plays and pauses; [ and ] step through errors and warnings.
function onReviewKey(event: KeyboardEvent) {
  if (!summary.value || isLive.value || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (target?.closest('input, textarea, select, button, [contenteditable], md-outlined-button, md-outlined-icon-button')) return;
  if (event.key === ' ') {
    event.preventDefault();
    if (playing.value) pause();
    else play();
  } else if (event.key === '[' || event.key === ']') {
    stepProblem(event.key === ']' ? 1 : -1);
  }
}
onMounted(() => window.addEventListener('keydown', onReviewKey));
onUnmounted(() => window.removeEventListener('keydown', onReviewKey));

// Lists the data logs again (new ones copied in, downloads since), keeping
// the open one if it's still there. On coming to the page, that's the one
// last open, here or before the app was closed.
async function loadLogs() {
  [logs.value, earlierRuns.value] = await Promise.all([window.diagnostics.getSignalLogs(), window.diagnostics.getEarlierRuns()]);
  const wanted = selectedLog.value || plotStore.logId;
  const there = isLiveNow(wanted) || logs.value.some((log) => log.id === wanted) ||
    earlierRuns.value.some((run) => run.id === wanted);
  selectedLog.value = there ? wanted : (robotLogs.value[0] ?? logs.value[0])?.id ?? '';
}

// The chart, saved as it changes.
plotStore.$subscribe(() => plotStore.save());

onMounted(loadLogs);

// A live run is kept a little after it's left (or when the robot code
// restarts), so the list of them is looked at again now and then.
const runsTimer = setInterval(async () => {
  earlierRuns.value = await window.diagnostics.getEarlierRuns();
}, 5000);
onUnmounted(() => clearInterval(runsTimer));

// A live session asked for by its keyboard shortcut (App.vue), as
// ?session=live:robot. Taken off the address once used, so the shortcut
// works again.
const route = useRoute();
const router = useRouter();
watch(() => route.query.session, (session) => {
  if (typeof session !== 'string' || !liveSessions.some((live) => live.id === session)) return;
  selectedLog.value = session;
  router.replace({ query: {} });
}, { immediate: true });
</script>

<template>
  <div class="signals-page" :class="{ 'sidebar-closed': !sidebarOpen }">
    <aside v-if="!sidebarOpen" class="card rail">
      <button id="open-sidebar" class="icon-button" title="Show the log and signals" aria-label="Show the log and signals"
        @click="sidebarOpen = true">»</button>
      <span class="rail-label">Signals</span>
      <progress v-if="hootStatus?.progress" class="rail-progress" :value="hootStatus.progress.percent" max="100"
        :title="`Extracting from ${hootStatus.progress.label}: ${hootStatus.progress.percent}%`"></progress>
    </aside>

    <aside v-show="sidebarOpen" class="card sidebar">
      <div class="sidebar-head">
        <button id="toggle-details" class="details-toggle" :aria-expanded="detailsOpen" @click="detailsOpen = !detailsOpen">
          <span class="chevron" :class="{ closed: !detailsOpen }">▾</span>
          <span class="details-title">{{ detailsOpen || !selectedLabel ? 'Log' : selectedLabel }}</span>
        </button>
        <button id="close-sidebar" class="icon-button" title="Hide the sidebar" aria-label="Hide the sidebar"
          @click="sidebarOpen = false">«</button>
      </div>

      <template v-if="detailsOpen">
        <label v-if="logs" class="field">
          <span class="log-row">
            <select id="signal-log" v-model="selectedLog" aria-label="Log">
              <optgroup label="Live">
                <option v-for="live in liveSessions" :key="live.id" :value="live.id">{{ live.label }}{{ settingsStore.settings.shortcuts[live.shortcut] ? ` (${settingsStore.settings.shortcuts[live.shortcut]})` : '' }}</option>
              </optgroup>
              <optgroup v-if="earlierRuns.length" label="Earlier live runs (kept until the app closes)">
                <option v-for="run in earlierRuns" :key="run.id" :value="run.id">{{ runLabel(run) }}</option>
              </optgroup>
              <optgroup v-if="robotLogs.length" label="Logs">
                <option v-for="log in robotLogs" :key="log.id" :value="log.id">
                  {{ logLabel(log) }} · {{ formatBytes(log.size) }}
                </option>
              </optgroup>
              <!-- Many: every time the Driver Station was open with a robot. -->
              <optgroup v-if="dsOnlyLogs.length" label="Driver Station logs on their own">
                <option v-for="log in dsOnlyLogs" :key="log.id" :value="log.id">
                  {{ logLabel(log) }} · {{ formatBytes(log.size) }}
                </option>
              </optgroup>
            </select>
            <button id="refresh-logs" class="icon-button" title="Look for new logs" aria-label="Look for new logs" @click.prevent="loadLogs">↻</button>
            <button v-if="selectedFile" id="delete-log" class="icon-button" title="Delete this log" aria-label="Delete this log"
              @click.prevent="askToDelete">🗑</button>
          </span>
        </label>
        <div v-if="logs && logs.length" class="log-filter" role="group" aria-label="Which logs to list">
          <select id="log-event" v-model="logFilter.event" aria-label="Event">
            <option :value="null">All events</option>
            <option v-for="event in logEvents" :key="event" :value="event">{{ event }}</option>
          </select>
          <label class="check" title="Practice, qualification and playoff matches: logs FMS named. Driver Station logs on their own don't say, so they're left out.">
            <input id="log-real-matches" v-model="logFilter.realMatches" type="checkbox" />
            Real matches only
          </label>
        </div>
        <p v-if="filterHidesAll" class="hint small">No logs match the filter.</p>
        <p v-if="logs && logs.length === 0" class="hint">No data logs here yet. They're downloaded from the robot on the Download page, or imported on the Storage page.</p>
        <p v-else-if="logs && !isLive" class="hint small">
          Logs in the data folder's <span class="path">logs</span>, downloaded or put there by hand: data logs, Hoot logs, and
          Driver Station logs with a robot connected.
        </p>
        <p v-if="isLive" id="log-summary" class="hint">
          Signals the robot code publishes to NetworkTables (DogLog does, under <span class="path">/Robot</span>), as they change.
          The last {{ liveKeepSeconds / 60 }} minutes are kept while this is open.
          <template v-if="summary">{{ withValues }} signals with values so far.</template>
        </p>
        <p v-else-if="summary" id="log-summary" class="hint">
          {{ Math.round(summary.duration) }} s{{ summary.startedAt ? `, from ${formatTime(summary.startedAt)}` : '' }}.
          {{ withValues }} signals with values.
          <template v-if="summary.truncated">The end of the file is cut off.</template>
        </p>
        <p v-for="warning in summary?.warnings ?? []" :key="warning" class="warning-text">{{ warning }}</p>
        <div v-if="hootStatus && hootStatus.hoots.length" id="hoot-status" class="hoots">
          <div v-for="hoot in hootStatus.hoots" :key="hoot.localPath" class="hoot">
            <strong>{{ hoot.label }}</strong> <span class="hint small">{{ formatBytes(hoot.size) }}</span>
            <div v-if="hoot.state === 'opening'" class="hint small">Lining up with the data log…</div>
            <div v-else-if="hoot.state === 'ready'" class="hint small">{{ describeAlignment(hoot) }}</div>
            <div v-if="hoot.message" :class="hoot.state === 'ready' ? 'hint small' : 'error-text small'">
              {{ hoot.message }}
              <RouterLink v-if="hoot.state === 'license' || hoot.state === 'owlet'" to="/settings">Settings</RouterLink>
            </div>
          </div>
        </div>
        <div v-if="summary?.dsLogs?.length" id="ds-status" class="hoots">
          <div v-for="ds in summary.dsLogs" :key="ds.localPath" class="hoot">
            <strong>{{ ds.label }}</strong> <span class="hint small">{{ formatBytes(ds.size) }}</span>
            <div class="hint small">{{ describeDsLog(ds) }}</div>
          </div>
        </div>
        <template v-if="summary">
          <div class="field-row">
            <span>Show signals with no values</span>
            <Switch id="show-empty-switch" :model-value="showEmpty" @update:model-value="showEmpty = $event"></Switch>
          </div>
          <p class="hint">Drag a signal onto the chart, or click to add it.</p>
        </template>
      </template>

      <!-- Shown even with the details put away. -->
      <div v-if="isLive" id="live-status" class="live-status" :class="liveStatus?.state ?? 'connecting'">
        <span class="dot"></span>
        <span>{{ describeLive(liveStatus) }}</span>
      </div>
      <p v-if="isLive && liveStatus?.message" class="hint small">{{ liveStatus.message }}</p>
      <p v-if="isLive && liveStatus?.stale && summary?.signals.length" id="stale-note" class="warning-text">
        {{ liveStatus.state === 'connected' ? 'A new run: until it has said what it has,' : 'Not connected:' }}
        these are the signals it last had, and their last values.
      </p>
      <p v-if="opening && !isLive" class="hint">Reading the log…</p>
      <p v-if="openError" class="error-text">This log can't be read: {{ openError }}</p>
      <div v-if="hootStatus?.progress" class="extracting">
        <span class="small">
          Extracting {{ hootStatus.progress.signals }} {{ hootStatus.progress.signals === 1 ? 'signal' : 'signals' }}
          from {{ hootStatus.progress.label }}: {{ hootStatus.progress.percent }}%
        </span>
        <progress :value="hootStatus.progress.percent" max="100"></progress>
      </div>

      <template v-if="summary">
        <TextInput id="signal-filter" :model-value="filter" label="Filter by name" @update:model-value="filter = $event"></TextInput>

        <div class="signal-list" :class="{ stale: isLive && liveStatus?.stale }" role="tree">
          <p v-if="treeRows.length === 0" class="hint">No signals match.</p>
          <template v-for="row in treeRows" :key="row.type === 'folder' ? `f${row.path}` : `s${row.signal.key}`">
            <button v-if="row.type === 'folder'" class="folder" :style="{ paddingLeft: `${row.depth * 14 + 4}px` }"
              :aria-expanded="row.open" :draggable="!!row.signal" @click="toggleFolder(row.path)"
              @dragstart="row.signal && onDragStart($event, row.signal.key)" @dragend="onDragEnd">
              <span class="chevron" :class="{ closed: !row.open }">▾</span>
              <span class="signal-name">{{ row.name }}</span>
              <span class="hint small">{{ row.count }}</span>
            </button>
            <div v-else class="signal" draggable="true" :title="row.signal.key"
              :style="{ paddingLeft: `${row.depth * 14 + 20}px` }"
              @dragstart="onDragStart($event, row.signal.key)" @dragend="onDragEnd" @click="place(row.signal)">
              <span class="swatch" :style="{ background: plotStore.trace(row.signal.key) ? colorOf(plotStore.trace(row.signal.key)!.color) : 'transparent' }"></span>
              <span class="signal-name">{{ row.name }}</span>
              <span class="leaf-value small" :title="leafText(row.signal)">{{ leafText(row.signal) }}</span>
            </div>
          </template>
        </div>
      </template>
    </aside>

    <section class="card chart-area">
      <PlotTabs v-if="summary" :panels="plotStore.panels" :active="shownPanel?.id ?? 'line'" @select="plotStore.showTab($event)"
        @add="addPlot" @close="plotStore.removePanel($event)" />
      <div class="toolbar">
        <!-- Material's zoom_in and zoom_out icons, drawn here (no icon font: the
          app has to work offline). -->
        <md-outlined-icon-button id="zoom-in" :disabled="!summary" title="Zoom in" aria-label="Zoom in" @click="zoomBy(0.5)">
          <svg viewBox="0 -960 960 960" width="20" height="20" aria-hidden="true">
            <path d="M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Zm-40-60v-80h-80v-80h80v-80h80v80h80v80h-80v80h-80Z" />
          </svg>
        </md-outlined-icon-button>
        <md-outlined-icon-button id="zoom-out" :disabled="!summary || (!plotStore.view && !isLive)" title="Zoom out" aria-label="Zoom out"
          @click="zoomBy(2)">
          <svg viewBox="0 -960 960 960" width="20" height="20" aria-hidden="true">
            <path d="M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400ZM280-540v-80h200v80H280Z" />
          </svg>
        </md-outlined-icon-button>
        <md-outlined-button id="zoom-all" :disabled="!summary || (!plotStore.view && !isLive)" @click="zoomTo(full, 'all')">Show all</md-outlined-button>
        <md-outlined-button v-if="isLive && !following" id="follow" @click="follow">Follow live</md-outlined-button>
        <span v-if="summary && following" id="view-range" class="hint">
          {{ liveWindow === null ? 'Everything kept' : `The last ${formatSpan(liveWindow)}` }}, following
        </span>
        <span v-else-if="summary && isLive" id="view-range" class="hint">
          {{ view[0].toFixed(2) }} – {{ view[1].toFixed(2) }} s, held still (now {{ full[1].toFixed(0) }} s)
        </span>
        <span v-else-if="summary" id="view-range" class="hint">
          {{ view[0].toFixed(2) }} – {{ view[1].toFixed(2) }} s of {{ full[1].toFixed(0) }} s
        </span>
        <span class="spacer"></span>
        <md-outlined-icon-button v-if="summary && onLine" id="copy-image" :disabled="copying"
          :title="copyState === 'copied' ? 'Copied' : 'Copy the chart and its signals as an image, to paste into a PR'"
          :aria-label="copyState === 'copied' ? 'Copied' : 'Copy the chart as an image'" @click="copyImage">
          <svg viewBox="0 -960 960 960" width="20" height="20" aria-hidden="true">
            <path v-if="copyState === 'copied'" d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z" />
            <path v-else
              d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z" />
          </svg>
        </md-outlined-icon-button>
        <ViewsMenu v-if="summary" :available="viewSignals" :robot="selectedRobot" :current="currentView" :can-phase="!!review?.phases.length"
          @apply="applySavedView" />
        <md-outlined-button v-if="plotStore.traces.length && onLine" @click="plotStore.clear()">Clear chart</md-outlined-button>
      </div>
      <p v-if="copyState !== 'idle' && copyState !== 'copied'" class="error-text">{{ copyState }}</p>
      <p v-if="!onLine" class="hint small">
        The span shown is the chart's: zoom here, or on the line chart's tab. The moment shown is the pin, the playhead, or now when following live.
      </p>
      <p v-else-if="isLive" class="hint small">
        Scroll to show more or less of the latest; Shift+scroll back, or drag across the chart, to hold it still. Double-click to follow everything kept.
      </p>
      <p v-else class="hint small">
        Scroll to zoom, Shift+scroll to pan, drag across the chart to zoom to it (Shift+drag to pick it for min, max and mean),
        double-click to show all. Click to pin a moment, or a
        marker along the top for what happened there. Space plays from the pin; [ and ] step through errors and warnings.
      </p>

      <div class="chart-body">
      <PanelView v-if="summary && shownPanel" ref="panelView" :key="shownPanel.id" :panel="shownPanel" :session="summary.id" :signals="summary.signals"
        :time="valueTime" :span="view" :following="following" :dark="viewMode.isDarkMode" :height="chartHeight" @seek="seek" />
      <div v-else class="chart-wrap" @dragover="onDragOverZone($event, 'default')" @dragleave="onDragLeaveChart" @drop.prevent="onDrop($event)">
        <PlotChart v-if="summary" ref="chartElement" v-model:pin="pin" v-model:range="range" :lines="chartLines" :axes="chartAxes" :view="view" :full="full"
          :height="chartHeight" :markers="markers" :phases="review?.phases ?? []" :selected-marker="selectedEvent"
          :pin-label="playing ? 'Playing at' : 'Pinned at'" @zoom="zoomTo" @width="plotWidth = $event" @marker="onMarker" />
        <div v-if="summary && plotStore.traces.length === 0 && !dragging" class="empty">
          Drag signals here, or click one in the list.
        </div>

        <!-- While dragging: where it can go. Text only goes in a band; anything
          can, to show a number as states (0/1 as false/true, a mode). -->
        <div v-if="dragging && draggingText" class="drop-zones bands">
          <div class="drop" :class="{ over: dropTarget === 'band-top' }"
            @dragover.stop="onDragOverZone($event, 'band-top')" @drop.prevent.stop="onDrop($event, { band: 'top' })">
            Top band <span class="hint">above the plot</span>
          </div>
          <div class="drop" :class="{ over: dropTarget === 'band-bottom' }"
            @dragover.stop="onDragOverZone($event, 'band-bottom')" @drop.prevent.stop="onDrop($event, { band: 'bottom' })">
            Bottom band <span class="hint">below the plot</span>
          </div>
        </div>
        <div v-else-if="dragging" class="drop-zones">
          <div class="drop-column">
            <div v-for="axis in leftAxes" :key="axis.id" class="drop" :class="{ over: dropTarget === axis.id }"
              @dragover.stop="onDragOverZone($event, axis.id)" @drop.prevent.stop="onDrop($event, { axis: axis.id })">
              {{ plotStore.axisName(axis.id) }} <span class="hint">{{ axisUnits(axis.id) }}</span>
            </div>
            <div class="drop new" :class="{ over: dropTarget === 'new-left' }"
              @dragover.stop="onDragOverZone($event, 'new-left')" @drop.prevent.stop="onDrop($event, { newAxis: 'left' })">
              + New left axis
            </div>
          </div>
          <div class="drop-column">
            <div class="drop band" :class="{ over: dropTarget === 'band-top' }"
              @dragover.stop="onDragOverZone($event, 'band-top')" @drop.prevent.stop="onDrop($event, { band: 'top' })">
              Top band <span class="hint">as states</span>
            </div>
            <div class="drop center" :class="{ over: dropTarget === 'default' }"
              @dragover.stop="onDragOverZone($event, 'default')" @drop.prevent.stop="onDrop($event)">
              {{ leftAxes.length ? `Add to ${plotStore.axisName(leftAxes[0].id)}` : 'Add to the chart' }}
            </div>
            <div class="drop band" :class="{ over: dropTarget === 'band-bottom' }"
              @dragover.stop="onDragOverZone($event, 'band-bottom')" @drop.prevent.stop="onDrop($event, { band: 'bottom' })">
              Bottom band <span class="hint">as states</span>
            </div>
          </div>
          <div class="drop-column">
            <div v-for="axis in rightAxes" :key="axis.id" class="drop" :class="{ over: dropTarget === axis.id }"
              @dragover.stop="onDragOverZone($event, axis.id)" @drop.prevent.stop="onDrop($event, { axis: axis.id })">
              {{ plotStore.axisName(axis.id) }} <span class="hint">{{ axisUnits(axis.id) }}</span>
            </div>
            <div class="drop new" :class="{ over: dropTarget === 'new-right' }"
              @dragover.stop="onDragOverZone($event, 'new-right')" @drop.prevent.stop="onDrop($event, { newAxis: 'right' })">
              + New right axis
            </div>
          </div>
        </div>
      </div>

      <!-- Playing back: Material's play_arrow and pause icons. -->
      <div v-if="summary && !isLive" id="playback" class="playback">
        <md-outlined-icon-button id="play" :title="playing ? 'Pause (Space)' : 'Play (Space)'" :aria-label="playing ? 'Pause' : 'Play'"
          @click="playing ? pause() : play()">
          <svg viewBox="0 -960 960 960" width="20" height="20" aria-hidden="true">
            <path v-if="playing" d="M520-200v-560h240v560H520Zm-320 0v-560h240v560H200Z" />
            <path v-else d="M320-200v-560l440 280-440 280Z" />
          </svg>
        </md-outlined-icon-button>
        <select id="speed" v-model.number="speed" aria-label="Playback speed">
          <option v-for="choice in speeds" :key="choice" :value="choice">{{ choice }}×</option>
        </select>
        <input id="scrub" type="range" :min="full[0]" :max="full[1]" step="0.01" :value="pin ?? view[0]" aria-label="Time"
          @input="scrub" />
        <span id="playhead" class="hint small playhead">
          <template v-if="pin !== null">{{ pin.toFixed(2) }} s<template v-if="phaseClock(review?.phases ?? [], pin)">
            · {{ phaseClock(review?.phases ?? [], pin) }}</template></template>
          <template v-else>Click the chart to pin a moment</template>
        </span>
      </div>

      <p v-if="message" class="error-text">{{ message }}</p>
      <p v-if="readError" class="error-text">{{ readError }}</p>

      <div v-if="plotStore.traces.length && onLine" id="trace-columns" class="trace-columns">
        <span class="hint small">Show</span>
        <button v-for="choice in columnChoices" :key="choice.id" class="chip" :aria-pressed="columns.includes(choice.id)"
          @click="toggleColumn(choice.id)">{{ choice.label }}</button>
      </div>
      <div v-if="plotStore.traces.length && onLine" ref="traceBox" class="trace-scroll"
        :style="{ maxHeight: traceBoxHeight === null ? 'none' : `${traceBoxHeight}px` }">
        <table id="trace-list" class="plain traces">
          <thead>
            <tr>
              <th></th>
              <th>Signal</th>
              <th>Axis</th>
              <th v-for="column in columns" :key="column" class="number">
                {{ column === 'value' ? valueHeading : columnChoices.find((c) => c.id === column)!.label }}
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="trace in plotStore.traces" :key="trace.key" draggable="true" :class="{ 'hidden-trace': trace.hidden }"
              @dragstart="onDragStart($event, trace.key)" @dragend="onDragEnd">
              <td class="trace-buttons">
                <button class="remove eye" :aria-pressed="!trace.hidden"
                  :aria-label="`${trace.hidden ? 'Show' : 'Hide'} ${trace.key}`" :title="trace.hidden ? 'Show on the chart' : 'Hide from the chart'"
                  @click="plotStore.toggleHidden(trace.key)">
                  <svg viewBox="0 -960 960 960" width="18" height="18" aria-hidden="true">
                    <path v-if="trace.hidden" d="m644-428-58-58q9-47-27-88t-93-32l-58-58q17-8 34.5-12t37.5-4q75 0 127.5 52.5T660-500q0 20-4 37.5T644-428Zm128 126-58-56q38-29 67.5-63.5T832-500q-50-101-143.5-160.5T480-720q-29 0-57 4t-55 12l-62-62q41-17 84-25.5t90-8.5q151 0 269 83.5T920-500q-23 59-60.5 109.5T772-302Zm20 246L624-222q-35 11-70.5 16.5T480-200q-151 0-269-83.5T40-500q21-53 53-98.5t73-81.5L56-792l56-56 736 736-56 56ZM222-624q-29 26-53 57t-41 67q50 101 143.5 160.5T480-280q20 0 39-2.5t39-5.5l-36-38q-11 3-21 4.5t-21 1.5q-75 0-127.5-52.5T300-500q0-11 1.5-21t4.5-21l-84-82Zm319 93Zm-151 75Z" />
                    <path v-else d="M480-320q75 0 127.5-52.5T660-500q0-75-52.5-127.5T480-680q-75 0-127.5 52.5T300-500q0 75 52.5 127.5T480-320Zm0-72q-45 0-76.5-31.5T372-500q0-45 31.5-76.5T480-608q45 0 76.5 31.5T588-500q0 45-31.5 76.5T480-392Zm0 192q-146 0-266-81.5T40-500q54-137 174-218.5T480-800q146 0 266 81.5T920-500q-54 137-174 218.5T480-200Zm0-300Zm0 220q113 0 207.5-59.5T832-500q-50-101-144.5-160.5T480-720q-113 0-207.5 59.5T128-500q50 101 144.5 160.5T480-280Z" />
                  </svg>
                </button>
                <ColorPicker :color="colorOf(trace.color)" :palette="themePalette" :label="trace.key"
                  @pick="plotStore.setColor(trace.key, $event)" />
              </td>
              <td class="trace-name" :title="trace.key">
                {{ signalsByKey.get(trace.key) ? signalLabel(signalsByKey.get(trace.key)!) : trace.key }}
                <span v-if="!signalsByKey.has(trace.key)" class="hint">(not in this log)</span>
                <span v-else-if="series.get(trace.key)?.times.length === 0" class="hint">(no values here)</span>
              </td>
              <td>
                <select :value="trace.axis === 'lanes' ? `band-${trace.band}` : trace.axis" :aria-label="`Axis for ${trace.key}`"
                  @change="setAxis(trace.key, ($event.target as HTMLSelectElement).value)">
                  <template v-if="trace.kind !== 'string'">
                    <option v-for="axis in plotStore.axes" :key="axis.id" :value="axis.id">{{ plotStore.axisName(axis.id) }}</option>
                    <option value="new-left">New left axis</option>
                    <option value="new-right">New right axis</option>
                  </template>
                  <option value="band-top">Top band</option>
                  <option value="band-bottom">Bottom band</option>
                </select>
              </td>
              <td v-for="column in columns" :key="column" class="number">{{ cell(trace.key, column) }}</td>
              <td><button class="remove" :aria-label="`Remove ${trace.key}`" @click="plotStore.remove(trace.key)">✕</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      </div>
      <p v-if="plotStore.traces.length && onLine" class="hint small">
        {{ following ? 'Values are the latest.' : pin !== null ? 'Values are at the pin.' : 'Values are at the right edge of the span shown.' }}
        <template v-if="showsStats && range">
          Min, max and mean are of {{ range[0].toFixed(2) }} – {{ range[1].toFixed(2) }} s
          (<button id="clear-range" class="link-button" @click="range = null">use the span shown</button>).
        </template>
        <template v-else-if="showsStats">Min, max and mean are of the span shown; Shift+drag across the chart for a range of it.</template> Up to {{ maxTraces }} signals; drag a row onto the chart to move it to another axis
        or band, click a colour to change it, and click the eye to hide it from the chart for now.
      </p>

      <EventList v-if="summary && !isLive" v-model:filter="eventFilter" :events="allEvents" :phases="review?.phases ?? []"
        :selected="selectedEvent" :pending="review ? review.pending : 'Looking through the log…'" :can-note="canNote" :note-time="noteTime"
        :dark="viewMode.isDarkMode" :caption="selectedLabel" @select="selectEvent" @step="stepProblem" @save-note="saveNote" @delete-note="deleteNote" />
    </section>
    <AppDialog :open="deleteOpen" title="Delete this log?" @close="deleteOpen = false">
      <p v-if="selectedFile">{{ selectedLabel }}</p>
      <ul class="delete-files">
        <li v-for="path in toDelete.remove" :key="path">{{ fileName(path) }}</li>
      </ul>
      <p v-if="toDelete.kept.length" class="hint small">
        Kept: {{ toDelete.kept.map(fileName).join(', ') }}, which another log also has.
      </p>
      <p class="hint small">
        The files go to the Recycle Bin, and the log's notes are deleted. If the log is still on the robot, the next download
        brings it back.
      </p>
      <p v-if="deleteError" class="error-text">{{ deleteError }}</p>
      <template #actions>
        <md-outlined-button @click="deleteOpen = false">Cancel</md-outlined-button>
        <md-filled-button id="confirm-delete-log" :disabled="deleting" @click="deleteSelected">{{ deleting ? 'Deleting…' : 'Delete' }}</md-filled-button>
      </template>
    </AppDialog>
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

.signals-page.sidebar-closed {
  grid-template-columns: auto minmax(0, 1fr);
}

.signals-page .card {
  max-width: none;
}

.rail {
  position: sticky;
  top: 80px;
  align-items: center;
  gap: 12px;
  padding: 10px 6px;
}

.rail-label {
  writing-mode: vertical-rl;
  font-weight: 600;
  font-size: 0.9rem;
  opacity: 0.8;
}

.rail-progress {
  width: 36px;
}

.sidebar-head {
  display: flex;
  gap: 6px;
  align-items: center;
}

.details-toggle {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 4px;
  align-items: center;
  padding: 4px 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.details-toggle:hover {
  background: rgba(127, 127, 127, 0.12);
}

.details-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-head .icon-button,
.rail .icon-button {
  height: 32px;
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

.signal-list.stale {
  opacity: 0.6;
}

.log-row {
  display: flex;
  gap: 6px;
}

.log-row select {
  flex: 1;
  min-width: 0;
}

.log-filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
}

.log-filter select {
  flex: 1;
  min-width: 0;
}

.log-filter .check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.delete-files {
  margin: 0;
  padding-left: 1.2em;
  overflow-wrap: anywhere;
}

.icon-button {
  flex: none;
  width: 36px;
  border: 1px solid rgba(127, 127, 127, 0.6);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font-size: 1.1rem;
  cursor: pointer;
}

.icon-button:hover {
  background: rgba(127, 127, 127, 0.15);
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

.live-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.live-status .dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #eda100;
}

.live-status.connected .dot {
  background: #1baf7a;
}

.live-status.disconnected .dot {
  background: #e34948;
}

.hoots {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.9rem;
}

.extracting progress {
  width: 100%;
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

.drop-zones.bands {
  grid-template-columns: 1fr;
  grid-template-rows: 1fr 1fr;
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

.drop.band {
  flex: 0 0 auto;
  min-height: 56px;
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

.leaf-value {
  flex: none;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
}

.trace-columns {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.chip {
  padding: 2px 10px;
  border: 1px solid rgba(127, 127, 127, 0.6);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}

.chip[aria-pressed='true'] {
  border-color: #2a78d6;
  background: color-mix(in srgb, #2a78d6 18%, transparent);
}

.playback {
  display: flex;
  align-items: center;
  gap: 10px;
}

.playback md-outlined-icon-button svg {
  fill: currentColor;
}

.playback input[type='range'] {
  flex: 1;
  accent-color: #2a78d6;
}

.playhead {
  min-width: 170px;
  font-variant-numeric: tabular-nums;
}

.chart-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.toolbar md-outlined-icon-button svg {
  fill: currentColor;
}

.trace-scroll {
  overflow-y: auto;
}

/* The header stays while the rows scroll under it, so it needs its own
   background (and no see-through). */
.traces thead th {
  position: sticky;
  /* Collapsed borders leave a gap above it otherwise. */
  top: -1px;
  z-index: 1;
  background-color: var(--table-header-background-color);
  opacity: 1;
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

.trace-buttons {
  white-space: nowrap;
}

.link-button {
  padding: 0;
  border: none;
  background: none;
  color: var(--link-color);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.eye {
  display: inline-flex;
  vertical-align: middle;
  padding: 2px;
}

.eye svg {
  fill: currentColor;
}

/* Off the chart for now: the row stays, quieter. */
.hidden-trace > td:not(.trace-buttons) {
  opacity: 0.5;
}
</style>
