<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useViewModeStore } from '@greybots/common/stores/view-mode-store';

import { eventKinds, phaseAt, phaseClock, tapeLabels, type LogEvent, type TapeKind } from '@shared/events';
import type { RenderedSection, Report, ReportLine, ReportPieSlice } from '@shared/library';
import type { SignalSeries } from '@shared/signals';
import PieChart, { sharePercent, type DonutSlice } from '@/components/PieChart.vue';
import PlotChart, { type ChartAxis, type ChartLine } from '@/components/PlotChart.vue';
import { formatTime } from '@/format';
import { colorFor, palette } from '@/palette';
import { eventColor, severityColor } from '@/review';
import { allianceFrom, visionStates, zoneAt, zoneLabels, type Alliance, type VisionCamera, type VisionState, type VisionTrack } from '@shared/vision';
import { defaultRobotSize, type Pose } from '@shared/plots';
import FieldCanvas, { type CanvasItem, type HeatLayer } from '@/components/FieldCanvas.vue';
import { heatPeak, heatShares } from '@shared/field-heat';
import { seasonFor } from '@/fields';

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
// --- Monitors and vision ---
const alarmColor = (severity: 'warning' | 'info' | undefined) => (severity === 'info' ? (dark.value ? '#9aa0a8' : '#8a8f98') : severityColor('warning', dark.value));
const stateColors: Record<VisionState, string> = { valid: '#2e9e5b', thrown: '#d03b3a', noTargets: '#8a8f98', noData: '#c98500' };
// A heatmap cell: its state's share of the bin's frames, as how solid it is.
function cellStyle(camera: VisionCamera, bin: number, state: VisionState) {
  const counts = camera.bins[bin];
  const total = counts.valid + counts.thrown + counts.noTargets + counts.noData;
  const share = total ? counts[state] / total : 0;
  return { background: stateColors[state], opacity: share ? Math.max(0.08, share) : 0 };
}
// Hovering the heatmap: the second under the pointer, its column marked
// across every camera's rows, and all of that column's counts in one
// readout beside it (as the charts' hover readout is).
const heatTipWidth = 260;
// The readout sits beside the pointer: below it in the heatmap's top half,
// above it in the bottom half (the bands), so it's always in sight.
const heat = ref<{ section: number; bin: number; left: number; width: number; tipLeft: number; tipY: { top?: string; bottom?: string } } | null>(null);
function heatHover(index: number, bins: number, event: PointerEvent) {
  const map = event.currentTarget as HTMLElement;
  const row = map.querySelector('.heat-row');
  if (!row || props.paper) return;
  const box = map.getBoundingClientRect();
  const rows = row.getBoundingClientRect();
  const bin = Math.floor(((event.clientX - rows.left) / rows.width) * bins);
  if (bin < 0 || bin >= bins) {
    heat.value = null;
    return;
  }
  const width = rows.width / bins;
  const left = rows.left - box.left + bin * width;
  const right = left + width + 10;
  const y = event.clientY - box.top;
  const tipY = y > box.height / 2 ? { bottom: `${Math.max(0, box.height - y - 12)}px` } : { top: `${Math.max(0, y - 12)}px` };
  heat.value = { section: index, bin, left, width, tipLeft: right + heatTipWidth > box.width ? Math.max(0, left - 10 - heatTipWidth) : right, tipY };
}
const binTotal = (camera: VisionCamera, bin: number) => {
  const c = camera.bins[bin];
  return c.valid + c.thrown + c.noTargets + c.noData;
};
const binCount = (camera: VisionCamera, bin: number, state: VisionState) => {
  const count = camera.bins[bin][state];
  const total = binTotal(camera, bin);
  return total ? `${count} (${Math.round((count / total) * 100)}%)` : '—';
};
// How long a cell is (reports made before cells were a second have longer).
const binLength = (bins: [number, number][]) => `${Number((bins[0][1] - bins[0][0]).toFixed(1))} s`;
const binTime = (bin: [number, number]) => {
  const clock = phaseClock(props.report.phases, bin[0]);
  return `${bin[0].toFixed(0)}–${bin[1].toFixed(0)} s${clock ? ` · ${clock}` : ''}`;
};

// --- Disagreement with the fused pose: charts, and the field at a moment ---
// Each camera's measurements, how far from the fused pose (metres) and
// which way off (degrees), on two charts zoomed and pinned together. The
// moment pinned (at first, the largest disagreement) is drawn on the field:
// the fused pose, and each camera's latest measurement then, overlaid.
type VisionSection = Extract<RenderedSection, { type: 'vision' }>;
const fusedColor = computed(() => (dark.value ? '#f2f2f2' : '#1f1f1f'));
const cameraColor = (index: number) => colorFor(index, dark.value);
const gapSeries = (key: string, times: number[], values: (number | null)[], unit: string): SignalSeries => {
  const kept = times.map((t, i) => [t, values[i]] as const).filter((p): p is readonly [number, number] => p[1] !== null);
  return { key, kind: 'number', times: Float64Array.from(kept.map((p) => p[0])), values: Float64Array.from(kept.map((p) => p[1])), downsampled: false, stats: null, unit };
};
const visionCharts = computed(() => props.report.sections.map((section) => {
  if (section.type !== 'vision' || !section.summary.cameras.some((c) => c.measured?.times.length)) return null;
  const bins = section.summary.bins;
  const full: [number, number] = [bins[0][0], bins[bins.length - 1][1]];
  const cameras = section.summary.cameras.filter((c) => c.measured);
  const lines = (measure: 'meters' | 'degrees', unit: string): ChartLine[] => cameras.map((camera) => ({
    key: `${camera.name}:${measure}`,
    label: camera.name,
    unit,
    color: cameraColor(section.summary.cameras.indexOf(camera)),
    axis: 'axis1',
    band: 'top',
    series: gapSeries(`${camera.name}:${measure}`, camera.measured!.times, camera.measured![measure], unit)
  }));
  // The largest distance, to show on the field first.
  let worst: number | null = null;
  let most = -1;
  for (const camera of cameras) {
    camera.measured!.meters.forEach((m, i) => {
      if (m > most) {
        most = m;
        worst = camera.measured!.times[i];
      }
    });
  }
  return { full, distance: lines('meters', 'm'), heading: lines('degrees', '°'), worst };
}));
const gapAxes: ChartAxis[] = [{ id: 'axis1', side: 'left', name: 'L1' }];
const visionViews = reactive<Record<number, [number, number]>>({});
const visionPins = reactive<Record<number, number | null>>({});
const visionView = (i: number) => visionViews[i] ?? visionCharts.value[i]!.full;
function visionZoom(i: number, next: [number, number], gesture: string) {
  visionViews[i] = gesture === 'all' ? visionCharts.value[i]!.full : next;
}
// Picked by clicking either chart; until then (or once unpinned), the
// largest disagreement, so the field always shows a moment.
const picked = (i: number) => visionPins[i] !== undefined && visionPins[i] !== null;
const visionPin = (i: number) => (picked(i) ? visionPins[i]! : visionCharts.value[i]?.worst ?? null);

// The latest of a track at or before t, if no older than `fresh` seconds.
function latestAt(times: number[], t: number, fresh = Infinity): number | null {
  let lo = 0;
  let hi = times.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found >= 0 && t - times[found] <= fresh ? found : null;
}
const poseOf = (x: number, y: number, heading: number | null): Pose =>
  ({ x, y, z: 0, qw: Math.cos((heading ?? 0) / 2), qx: 0, qy: 0, qz: Math.sin((heading ?? 0) / 2), heading: heading !== null });
const trackPose = (track: VisionTrack, i: number) => poseOf(track.x[i], track.y[i], track.heading[i]);
// How long a camera's measurement stays its latest (as the monitor takes it).
const freshSeconds = 0.5;

interface FieldRow {
  name: string;
  color: string;
  where: string;
  gap: string;
}
function visionField(section: VisionSection, t: number): { items: CanvasItem[]; rows: FieldRow[] } {
  const items: CanvasItem[] = [];
  const rows: FieldRow[] = [];
  const where = (p: Pose) => `${p.x.toFixed(2)}, ${p.y.toFixed(2)} m${p.heading ? `, ${((2 * Math.atan2(p.qz, p.qw) * 180) / Math.PI).toFixed(0)}°` : ''}`;
  const fused = section.summary.fused;
  const at = fused ? latestAt(fused.times, t) : null;
  if (fused && at !== null) {
    const pose = trackPose(fused, at);
    // Where it had been over the last two seconds.
    const history: Pose[] = [];
    for (let i = at; i >= 0 && fused.times[i] >= t - 2; i--) history.unshift(trackPose(fused, i));
    items.push({ key: 'fused', color: fusedColor.value, style: 'robot', opacity: 0.85, poses: [pose], history });
    rows.push({ name: 'Fused pose', color: fusedColor.value, where: where(pose), gap: '' });
  }
  section.summary.cameras.forEach((camera, index) => {
    const m = camera.measured;
    const color = cameraColor(index);
    const i = m ? latestAt(m.times, t, freshSeconds) : null;
    if (!m || i === null) {
      rows.push({ name: camera.name, color, where: 'No measurement', gap: '' });
      return;
    }
    const pose = trackPose(m, i);
    items.push({ key: camera.name, color, style: 'robot', opacity: 1, poses: [pose], history: [], outline: true });
    const degrees = m.degrees[i];
    rows.push({ name: camera.name, color, where: `${where(pose)} (${(t - m.times[i]).toFixed(2)} s before)`,
      gap: `${m.meters[i].toFixed(2)} m${degrees === null ? '' : `, ${degrees.toFixed(1)}°`} off` });
  });
  return { items, rows };
}
// Each vision section's field, at its moment.
const visionFields = computed(() => props.report.sections.map((section, i) => {
  const t = section.type === 'vision' && visionCharts.value[i] ? visionPin(i) : null;
  return section.type === 'vision' && t !== null ? visionField(section, t) : null;
}));

// --- The heatmap's bands, and picking a moment on it ---
// Under the cameras: what the match was doing each second (auto, teleop,
// endgame, disabled), and where on the field the robot was (its alliance's
// zone, the neutral zone or the other's; left or right as its drivers see
// it). Clicking the heatmap pins that moment for the charts and the field
// below; the moment pinned is marked down the heatmap's columns too.
const phaseColors: Record<TapeKind, string> = { disabled: '#6b7079', enabled: '#2a78d6', auto: '#c98500', teleop: '#2e9e5b', endgame: '#1d6e43' };
const allianceColors: Record<Alliance, string> = { blue: '#2a78d6', red: '#d03b3a' };
interface BandCell {
  key: string;
  label: string;
  color: string;
  // The right side of the field, drawn striped.
  striped?: boolean;
}
interface BandRun extends BandCell {
  from: number;
  count: number;
}
// Neighbouring seconds alike as one stretch, named once.
function runsOf(cells: (BandCell | null)[]): BandRun[] {
  const runs: BandRun[] = [];
  cells.forEach((cell, bin) => {
    const last = runs[runs.length - 1];
    if (!cell) return;
    if (last && last.key === cell.key && last.from + last.count === bin) last.count += 1;
    else runs.push({ ...cell, from: bin, count: 1 });
  });
  return runs;
}
const visionBands = computed(() => props.report.sections.map((section) => {
  if (section.type !== 'vision' || section.summary.bins.length === 0) return null;
  const bins = section.summary.bins;
  const mid = (bin: number) => (bins[bin][0] + bins[bin][1]) / 2;
  const phases = bins.map((_, bin): BandCell => {
    const kind: TapeKind = phaseAt(props.report.phases, mid(bin))?.phase.name ?? 'disabled';
    return { key: kind, label: tapeLabels[kind], color: phaseColors[kind] };
  });
  const fused = section.summary.fused;
  const autoStart = props.report.phases.find((p) => p.name === 'auto')?.start ?? null;
  const alliance = allianceFrom(fused, autoStart);
  const zones = bins.map((_, bin): BandCell | null => {
    if (!fused || !alliance) return null;
    const i = latestAt(fused.times, mid(bin), 1);
    if (i === null) return null;
    const { zone, side } = zoneAt(fused.x[i], fused.y[i], alliance);
    const color = zone === 'neutral' ? '#7b6fb0' : allianceColors[(zone === 'ours') === (alliance === 'blue') ? 'blue' : 'red'];
    return { key: `${zone}:${side}`, label: `${zoneLabels[zone]} · ${side}`, color, striped: side === 'right' };
  });
  return { phases, zones, alliance, phaseRuns: runsOf(phases), zoneRuns: alliance ? runsOf(zones) : [] };
}));
const heatGrid = (bins: number) => ({ gridTemplateColumns: `repeat(${bins}, minmax(0, 1fr))`, columnGap: bins > 300 ? '0' : '1px' });
const runStyle = (run: BandRun) => ({
  gridColumn: `${run.from + 1} / span ${run.count}`,
  background: run.striped ? `repeating-linear-gradient(135deg, ${run.color} 0 6px, color-mix(in srgb, ${run.color} 62%, #000) 6px 9px)` : run.color
});

// The time under the pointer on the heatmap, if over its cells.
function heatTime(section: VisionSection, event: MouseEvent): number | null {
  const row = (event.currentTarget as HTMLElement).querySelector('.heat-row');
  if (!row) return null;
  const box = row.getBoundingClientRect();
  const share = (event.clientX - box.left) / box.width;
  if (share < 0 || share > 1) return null;
  const bins = section.summary.bins;
  return bins[0][0] + share * (bins[bins.length - 1][1] - bins[0][0]);
}
function heatPick(i: number, section: VisionSection, event: MouseEvent) {
  if (props.paper) return;
  const t = heatTime(section, event);
  if (t !== null) visionPins[i] = t;
}
// The second the moment pinned is in, as a column down every row.
function pinnedBin(i: number, section: VisionSection): number | null {
  const t = visionPin(i);
  if (t === null) return null;
  const at = section.summary.bins.findIndex(([a, b]) => t >= a && t < b);
  return at >= 0 ? at : t >= section.summary.bins[section.summary.bins.length - 1][1] ? section.summary.bins.length - 1 : null;
}
const pinStyle = (bin: number, bins: number) => ({ left: `${(bin / bins) * 100}%`, width: `${100 / bins}%` });

// --- Where each camera had valid targets ---
// Each camera's frames used, by where the robot was, overlaid on one field
// in the camera's colour, on one scale (so a camera that used more shows
// stronger). Each can be hidden, to see the others under it.
const hiddenCameras = reactive<Record<string, boolean>>({});
const heatKey = (i: number, name: string) => `${i}:${name}`;
const visionHeat = computed(() => props.report.sections.map((section, i) => {
  if (section.type !== 'vision' || !section.summary.cameras.some((c) => c.validHeat?.cells.length)) return null;
  const shown = section.summary.cameras.map((camera, index) => ({ camera, index }))
    .filter(({ camera }) => camera.validHeat && !hiddenCameras[heatKey(i, camera.name)]);
  const top = Math.max(0, ...shown.map(({ camera }) => heatPeak(camera.validHeat!) ?? 0));
  const layers: HeatLayer[] = shown.map(({ camera, index }) => ({
    key: camera.name,
    color: cameraColor(index),
    cell: camera.validHeat!.cell,
    cells: heatShares(camera.validHeat!, top || undefined)
  }));
  return { layers, top };
}));

const percent = (share: number | null) => (share === null ? '—' : `${Math.round(share * 100)}%`);
const meters = (value: number | null) => (value === null ? '—' : `${value.toFixed(2)} m`);

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
      <section v-else-if="section.type === 'monitors'" class="monitors-section">
        <h4>{{ section.title }}</h4>
        <table class="plain monitors">
          <tbody>
            <template v-for="result in section.results" :key="result.id">
              <tr>
                <td>{{ result.name }}</td>
                <td v-if="!result.checked" class="hint small">Not checked: this log hasn't {{ result.missing.slice(0, 2).join(', ') }}{{ result.missing.length > 2 ? ', …' : '' }}</td>
                <td v-else-if="result.alarms.length === 0" class="small">No alarms</td>
                <td v-else class="small"><strong>{{ result.alarms.length }} alarm{{ result.alarms.length === 1 ? '' : 's' }}</strong></td>
              </tr>
              <tr v-for="(alarm, i) in result.alarms" :key="`${result.id}-${i}`" class="alarm">
                <td colspan="2">
                  <span class="mark" :style="{ background: alarmColor(alarm.severity) }"></span>
                  <span class="time small">{{ at(alarm.start) }}</span>
                  {{ alarm.title }} <span class="hint small">{{ alarm.detail }}</span>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </section>

      <section v-else-if="section.type === 'vision'" class="vision-section">
        <h4>{{ section.title }}</h4>
        <p v-if="section.summary.cameras.length === 0" class="hint small">This log has no cameras' counters.</p>
        <template v-else>
          <table class="plain">
            <thead>
              <tr><th>Camera</th><th>Used</th><th>Thrown out</th><th>Used, of frames with targets</th><th>No targets</th><th>No data</th><th>From the fused pose</th></tr>
            </thead>
            <tbody>
              <tr v-for="camera in section.summary.cameras" :key="camera.name">
                <td>{{ camera.name }}</td>
                <td>{{ camera.totals.valid }}</td>
                <td :title="camera.thrownBy.map((r) => `${r.reason}: ${r.count}`).join('\n')">
                  {{ camera.totals.thrown }}<span v-if="camera.thrownBy.length" class="hint small"> ({{ camera.thrownBy[0].reason }}{{ camera.thrownBy.length > 1 ? ', …' : '' }})</span>
                </td>
                <td><strong>{{ percent(camera.usedShare) }}</strong></td>
                <td>{{ camera.totals.noTargets }}</td>
                <td>{{ camera.totals.noData }}</td>
                <td class="small">{{ meters(camera.pose.meanMeters) }} average, {{ meters(camera.pose.maxMeters) }} at most</td>
              </tr>
            </tbody>
          </table>
          <div class="heatmap" role="img" :aria-label="`When each camera had each state, second by second, over ${section.summary.bins.length} s`"
            :class="{ pickable: !paper }" @pointermove="heatHover(i, section.summary.bins.length, $event)" @pointerleave="heat = null"
            @click="heatPick(i, section, $event)">
            <template v-for="camera in section.summary.cameras" :key="camera.name">
              <div class="heat-camera">{{ camera.name }}</div>
              <template v-for="state in visionStates" :key="state.state">
                <div class="heat-label small">{{ state.label }}</div>
                <div class="heat-row" :style="heatGrid(section.summary.bins.length)">
                  <span v-for="(_, bin) in section.summary.bins" :key="bin" class="heat-cell" :style="cellStyle(camera, bin, state.state)"></span>
                  <span v-if="pinnedBin(i, section) !== null" class="heat-pin" :style="pinStyle(pinnedBin(i, section)!, section.summary.bins.length)"></span>
                </div>
              </template>
            </template>
            <template v-if="visionBands[i]">
              <div class="heat-camera">Context</div>
              <div class="heat-label small">Match</div>
              <div class="heat-row band" :style="heatGrid(section.summary.bins.length)">
                <span v-for="run in visionBands[i]!.phaseRuns" :key="run.from" class="band-run" :style="runStyle(run)">
                  <span class="band-text">{{ run.label }}</span>
                </span>
                <span v-if="pinnedBin(i, section) !== null" class="heat-pin" :style="pinStyle(pinnedBin(i, section)!, section.summary.bins.length)"></span>
              </div>
              <template v-if="visionBands[i]!.alliance">
                <div class="heat-label small">Field zone</div>
                <div class="heat-row band" :style="heatGrid(section.summary.bins.length)">
                  <span v-for="run in visionBands[i]!.zoneRuns" :key="run.from" class="band-run" :style="runStyle(run)">
                    <span class="band-text">{{ run.label }}</span>
                  </span>
                  <span v-if="pinnedBin(i, section) !== null" class="heat-pin" :style="pinStyle(pinnedBin(i, section)!, section.summary.bins.length)"></span>
                </div>
              </template>
            </template>
            <div class="heat-axis small hint">
              <span>{{ at(section.summary.bins[0][0]) }}</span>
              <span>{{ binLength(section.summary.bins) }} a cell{{ paper ? '' : ' · click to pick a moment' }}</span>
              <span>{{ at(section.summary.bins[section.summary.bins.length - 1][1]) }}</span>
            </div>
            <template v-if="heat && heat.section === i">
              <div class="heat-column" :style="{ left: `${heat.left}px`, width: `${heat.width}px` }"></div>
              <div class="tooltip heat-tip" :style="{ left: `${heat.tipLeft}px`, width: `${heatTipWidth}px`, ...heat.tipY }">
                <div class="tooltip-time"><span>{{ binTime(section.summary.bins[heat.bin]) }}</span></div>
                <!-- The bands under the cameras, as they're named there. -->
                <template v-if="visionBands[i]">
                  <div class="tooltip-camera">Context</div>
                  <div class="tooltip-row">
                    <span class="swatch" :style="{ background: visionBands[i]!.phases[heat.bin].color }"></span>
                    <span class="tooltip-label">Match</span>
                    <span class="tooltip-value">{{ visionBands[i]!.phases[heat.bin].label }}</span>
                  </div>
                  <div v-if="visionBands[i]!.alliance" class="tooltip-row">
                    <span class="swatch" :style="{ background: visionBands[i]!.zones[heat.bin]?.color ?? 'transparent' }"></span>
                    <span class="tooltip-label">Field zone</span>
                    <span class="tooltip-value">{{ visionBands[i]!.zones[heat.bin]?.label ?? 'No pose' }}</span>
                  </div>
                </template>
                <template v-for="camera in section.summary.cameras" :key="camera.name">
                  <div class="tooltip-camera">{{ camera.name }}<span v-if="binTotal(camera, heat.bin) === 0" class="hint"> · nothing counted</span></div>
                  <div v-for="state in visionStates" :key="state.state" class="tooltip-row">
                    <span class="swatch" :style="{ background: stateColors[state.state] }"></span>
                    <span class="tooltip-label">{{ state.label }}</span>
                    <span class="tooltip-value">{{ binCount(camera, heat.bin, state.state) }}</span>
                  </div>
                </template>
              </div>
            </template>
          </div>
          <template v-if="visionHeat[i]">
            <h4 class="sub">Where each camera had valid targets</h4>
            <div class="vision-field">
              <FieldCanvas :items="[]" :heat="visionHeat[i]!.layers" :season="seasonFor(section.recorded)" :rotation="0"
                :robot-size="defaultRobotSize" :max-height="paper ? 260 : 360" />
              <div class="small">
                <p class="hint">
                  Frames each camera used, by where the robot was (half-metre squares), overlaid in its colour. The most solid square is
                  {{ visionHeat[i]!.top }} frames; the rest by how many of that.
                </p>
                <div class="heat-cameras">
                  <button v-for="(camera, c) in section.summary.cameras.filter((cam) => cam.validHeat)" :key="camera.name" class="chip"
                    :aria-pressed="!hiddenCameras[heatKey(i, camera.name)]" :disabled="paper"
                    @click="hiddenCameras[heatKey(i, camera.name)] = !hiddenCameras[heatKey(i, camera.name)]">
                    <span class="swatch" :style="{ background: cameraColor(section.summary.cameras.indexOf(camera)) }"></span>
                    {{ camera.name }} · {{ camera.totals.valid }} used
                  </button>
                </div>
              </div>
            </div>
          </template>
          <template v-if="visionCharts[i]">
            <h4 class="sub">Distance from the fused pose</h4>
            <PlotChart :lines="visionCharts[i]!.distance" :axes="gapAxes" :view="visionView(i)" :full="visionCharts[i]!.full"
              :height="paper ? 180 : 220" :phases="report.phases" :pin="visionPin(i)"
              @update:pin="visionPins[i] = $event" @zoom="(next, gesture) => visionZoom(i, next, gesture)" />
            <h4 class="sub">Heading from the fused pose</h4>
            <PlotChart :lines="visionCharts[i]!.heading" :axes="gapAxes" :view="visionView(i)" :full="visionCharts[i]!.full"
              :height="paper ? 180 : 220" :phases="report.phases" :pin="visionPin(i)"
              @update:pin="visionPins[i] = $event" @zoom="(next, gesture) => visionZoom(i, next, gesture)" />
            <p class="legend small">
              <span v-for="(camera, c) in section.summary.cameras" :key="camera.name" class="legend-item">
                <span class="swatch" :style="{ background: cameraColor(c) }"></span>{{ camera.name }}
              </span>
              <span class="hint">Heading only where the camera gave one (MegaTag 1).</span>
            </p>
            <template v-if="visionFields[i]">
              <h4 class="sub">
                On the field at {{ at(visionPin(i)!) }}<template v-if="visionBands[i] && pinnedBin(i, section) !== null
                  && visionBands[i]!.zones[pinnedBin(i, section)!]"> · {{ visionBands[i]!.zones[pinnedBin(i, section)!]!.label }}</template>
                <span class="hint small">{{ picked(i) ? '' : '(the largest disagreement)' }}{{ paper ? '' : ' · click either chart to pick another moment' }}</span>
              </h4>
              <div class="vision-field">
                <FieldCanvas :items="visionFields[i]!.items" :season="seasonFor(section.recorded)" :rotation="0"
                  :robot-size="defaultRobotSize" :max-height="paper ? 260 : 360" />
                <table class="plain small">
                  <tbody>
                    <tr v-for="row in visionFields[i]!.rows" :key="row.name">
                      <td><span class="swatch" :style="{ background: row.color }"></span>{{ row.name }}</td>
                      <td>{{ row.where }}</td>
                      <td><strong>{{ row.gap }}</strong></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
          </template>
          <p v-if="visionBands[i]?.alliance" class="hint small">
            Field zone: the {{ visionBands[i]!.alliance }} alliance's (where the robot started auto), as its drivers see it; the right side
            striped. Zones end at each hub's line.
          </p>
          <p v-if="section.alarms.length" class="small">
            Disagreeing with the fused pose:
            <span v-for="(alarm, i) in section.alarms" :key="i" class="disagree">{{ at(alarm.start) }} {{ alarm.title }} ({{ alarm.detail }}){{ i < section.alarms.length - 1 ? '; ' : '' }}</span>
          </p>
          <p v-else class="hint small">No camera disagreed with the fused pose for long.</p>
        </template>
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
.monitors td {
  vertical-align: top;
}

.monitors .alarm td {
  padding-left: 16px;
}

.monitors .mark {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 6px;
  border-radius: 50%;
}

.vision-section table {
  margin-bottom: 10px;
}

.heatmap {
  position: relative;
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 2px 8px;
  align-items: center;
}

.heat-camera {
  grid-column: 1 / -1;
  margin-top: 6px;
  font-weight: 700;
}

.heat-row {
  position: relative;
  display: grid;
  gap: 1px;
  height: 14px;
}

.heat-cell {
  display: block;
  height: 100%;
  border-radius: 2px;
}

/* The hovered second, across every row; and its readout, as the charts'. */
.heat-column {
  position: absolute;
  top: 0;
  bottom: 0;
  pointer-events: none;
  outline: 1.5px solid currentColor;
  outline-offset: 0;
  border-radius: 2px;
  opacity: 0.7;
}

.heat-tip {
  position: absolute;
  z-index: 1;
  box-sizing: border-box;
  pointer-events: none;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--tile-background-color);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
  font-size: 0.8rem;
}

.heat-tip .tooltip-time {
  opacity: 0.7;
  margin-bottom: 4px;
}

.heat-tip .tooltip-camera {
  margin-top: 4px;
  font-weight: 700;
}

.heat-tip .tooltip-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.heat-tip .tooltip-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.heat-tip .tooltip-value {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.heat-tip .swatch {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.vision-section .sub {
  margin: 14px 0 4px;
}

.vision-field {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(220px, 2fr);
  gap: 12px;
  align-items: start;
}

.paper .vision-field {
  grid-template-columns: 1fr;
}

.heat-cameras {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.heat-cameras .chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border: 1px solid rgba(127, 127, 127, 0.6);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.heat-cameras .chip[aria-pressed='false'] {
  opacity: 0.45;
  text-decoration: line-through;
}

.heat-cameras .swatch,
.vision-field .swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-right: 6px;
  border-radius: 2px;
}

.heatmap.pickable {
  cursor: pointer;
}

/* The moment pinned: a column down every row. */
.heat-pin {
  position: absolute;
  top: -1px;
  bottom: -1px;
  box-sizing: border-box;
  min-width: 2px;
  border: 2px solid currentColor;
  border-radius: 2px;
  pointer-events: none;
}

.heat-row.band {
  height: 18px;
}

.band-run {
  display: flex;
  align-items: center;
  min-width: 0;
  overflow: hidden;
  border-radius: 2px;
}

.band-text {
  padding: 0 4px;
  overflow: hidden;
  white-space: nowrap;
  color: #fff;
  font-size: 0.68rem;
  font-weight: 600;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.5);
}

.heat-axis {
  grid-column: 2;
  display: flex;
  justify-content: space-between;
}

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
