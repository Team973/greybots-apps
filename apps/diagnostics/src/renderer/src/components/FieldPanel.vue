<script setup lang="ts">
import { computed, ref } from 'vue';

import {
  isPoseType,
  isSinglePoseType,
  maxFieldItems,
  posesFrom,
  poseWindow,
  recordAt,
  yawOf,
  type FieldItem,
  type FieldPanel,
  type FieldRotation,
  type FieldStyle,
  type Pose
} from '@shared/plots';
import type { SignalInfo } from '@shared/signals';
import ColorPicker from '@/components/ColorPicker.vue';
import FieldCanvas, { type CanvasItem, type HeatLayer } from '@/components/FieldCanvas.vue';
import { fieldHeat, heatMeasureLabels, heatTotal, type HeatMeasure } from '@shared/field-heat';
import { fieldImages } from '@/fields';
import { palette } from '@/palette';
import { useRecords, useSeries } from '@/panel-data';

// Poses on the field (#144): robots as squares the size of one, with their
// heading, where they've been behind them; trajectories as paths. At the
// moment the rest of the page shows.

const props = defineProps<{
  panel: FieldPanel;
  session: string;
  signals: SignalInfo[];
  time: number;
  span: [number, number];
  dark: boolean;
  editing: boolean;
  // The most the field may take up and down, pixels.
  maxHeight?: number;
}>();

const emit = defineEmits<{
  update: [panel: FieldPanel];
}>();

const themePalette = computed(() => (props.dark ? palette.dark : palette.light));
const colorOf = (color: number | string) => (typeof color === 'number' ? themePalette.value[color] ?? themePalette.value[0] : color);

const byKey = computed(() => new Map(props.signals.map((s) => [s.key, s])));
// Signals that are poses: WPILib's geometry structs, lists of them, and
// Field2d's numbers (a double[] named like one).
const candidates = computed(() => props.signals.filter((s) => !s.parent && s.count !== 0 && isPoseType(s.type) &&
  (s.type !== 'double[]' || /field|pose|robot|traj/i.test(s.key))));
const labelOf = (key: string) => {
  const signal = byKey.value.get(key);
  return signal ? (signal.subsystem ? `${signal.subsystem} / ${signal.name}` : signal.name) : key;
};

function update(change: Partial<FieldPanel>) {
  emit('update', { ...props.panel, ...change });
}

function updateItem(index: number, change: Partial<FieldItem>) {
  update({ items: props.panel.items.map((item, i) => (i === index ? { ...item, ...change } : item)) });
}

function addItem(key: string) {
  if (!key || props.panel.items.some((item) => item.key === key) || props.panel.items.length >= maxFieldItems) return;
  const type = byKey.value.get(key)?.type ?? '';
  const used = new Set(props.panel.items.map((item) => item.color));
  const color = [...Array(maxFieldItems).keys()].find((slot) => !used.has(slot)) ?? 0;
  // A list of poses is likelier a trajectory than robots.
  const style: FieldStyle = isSinglePoseType(type) || type === 'double[]' ? 'robot' : 'path';
  update({ items: [...props.panel.items, { key, style, color, opacity: 1 }] });
}

function removeItem(index: number) {
  update({ items: props.panel.items.filter((_, i) => i !== index) });
}

function rotate() {
  update({ rotation: (((props.panel.rotation + 90) % 360) as FieldRotation) });
}

// --- Reading ---

// Paths are drawn over the span shown. Everything else is drawn at the
// moment shown (with its trail behind), so it's read around that moment:
// a read over a long span keeps only its latest values (see poseWindow).
const session = computed(() => props.session);
// Heatmaps are over the span shown too, with the signal each measures.
const overSpan = (item: FieldItem) => item.style === 'path' || item.style === 'heat';
const pathKeys = computed(() => props.panel.items.filter(overSpan).map((item) => item.key));
const momentKeys = computed(() => props.panel.items.filter((item) => !overSpan(item)).map((item) => item.key));
const valueKeys = computed(() => props.panel.items.filter((item) => item.style === 'heat' && item.measure !== 'time' && item.value).map((item) => item.value!));
const pathSpan = computed<[number, number]>(() => [props.span[0], props.span[1]]);
const momentSpan = computed<[number, number]>(() => {
  const [from, to] = poseWindow(props.time);
  return [Math.min(from, props.time - props.panel.trail), to];
});
const paths = useRecords(session, pathKeys, pathSpan);
// Read again when the span shown moves too: following live, that is new data.
const moments = useRecords(session, momentKeys, momentSpan, undefined, () => props.span[1]);
const values = useSeries(session, valueKeys, pathSpan);
const error = computed(() => [...new Set([paths.error.value, moments.error.value, values.error.value].filter(Boolean))].join(' '));

interface Drawn {
  item: FieldItem;
  type: string;
  // At the moment shown.
  poses: Pose[];
  // A single pose's, over the trail (robots, dots) or the span (paths).
  history: Pose[];
}

const drawn = computed<Drawn[]>(() => props.panel.items.map((item) => {
  const found = (overSpan(item) ? paths : moments).records.value.get(item.key);
  if (!found) return { item, type: '', poses: [], history: [] };
  const poses = posesFrom(recordAt(found, props.time), found.type);
  let history: Pose[] = [];
  if (isSinglePoseType(found.type) || found.type === 'double[]') {
    const from = item.style === 'path' ? props.span[0] : props.time - props.panel.trail;
    const to = item.style === 'path' ? props.span[1] : props.time;
    if (item.style === 'path' || props.panel.trail > 0) {
      for (let i = 0; i < found.times.length; i++) {
        if (found.times[i] < from || found.times[i] > to) continue;
        history.push(...posesFrom(found.values[i], found.type).slice(0, 1));
      }
    }
  }
  return { item, type: found.type, poses, history };
}));

// --- Drawing ---

const fieldCanvas = ref<InstanceType<typeof FieldCanvas> | null>(null);
// Each heatmap: where its pose was over the span shown, and what it
// measures there (field-heat.ts).
const heats = computed(() => new Map(props.panel.items.filter((item) => item.style === 'heat').map((item) => {
  const found = paths.records.value.get(item.key);
  const measure: HeatMeasure = item.measure ?? 'time';
  if (!found) return [item.key, null] as const;
  const track = { times: [] as number[], x: [] as number[], y: [] as number[] };
  for (let i = 0; i < found.times.length; i++) {
    const pose = posesFrom(found.values[i], found.type)[0];
    if (!pose) continue;
    track.times.push(found.times[i]);
    track.x.push(pose.x);
    track.y.push(pose.y);
  }
  const series = measure !== 'time' && item.value ? values.series.value.get(item.value) : null;
  const signal = series && series.values instanceof Float64Array ? { times: series.times, values: series.values } : null;
  // Measuring a signal that isn't read (yet): nothing, rather than time.
  if (measure !== 'time' && !signal) return [item.key, null] as const;
  return [item.key, fieldHeat(track, signal, measure, [props.span])] as const;
})));
const heatLayers = computed<HeatLayer[]>(() => props.panel.items.flatMap((item) => {
  const heat = heats.value.get(item.key);
  return item.style === 'heat' && heat ? [{ key: item.key, color: colorOf(item.color), heat }] : [];
}));

const canvasItems = computed<CanvasItem[]>(() => drawn.value.filter(({ item }) => item.style !== 'heat').map(({ item, poses, history }) => ({
  key: item.key,
  color: colorOf(item.color),
  style: item.style,
  opacity: item.opacity,
  poses,
  history
})));
// Where the pointer is, in field metres.
const pointer = ref<{ x: number; y: number } | null>(null);

const amount = (value: number) => (Math.abs(value) >= 100 ? value.toFixed(0) : value.toPrecision(3));
const legend = computed(() => drawn.value.map(({ item, poses }) => {
  if (item.style === 'heat') {
    const heat = heats.value.get(item.key);
    const sum = heat ? heatTotal(heat) : null;
    const where = !heat || !sum ? (item.measure && item.measure !== 'time' && !item.value ? 'Pick a signal' : '—')
      : sum.points === 0 ? 'Nowhere in the span'
        : heat.measure === 'time' ? `${sum.total.toFixed(1)} s, ${sum.points} points`
          : heat.measure === 'mean' ? `${amount(sum.low!)} to ${amount(sum.high!)}, ${sum.points} points`
            : `${amount(sum.total)} in all, ${sum.points} points`;
    return { key: item.key, color: colorOf(item.color), label: labelOf(item.key), where };
  }
  const pose = poses.length === 1 ? poses[0] : null;
  const where = pose
    ? `${pose.x.toFixed(2)}, ${pose.y.toFixed(2)} m${pose.heading ? `, ${((yawOf(pose) * 180) / Math.PI).toFixed(0)}°` : ''}`
    : poses.length > 1 ? `${poses.length} poses` : '—';
  return { key: item.key, color: colorOf(item.color), label: labelOf(item.key), where };
}));

const styles: { id: FieldStyle; label: string }[] = [
  { id: 'robot', label: 'Robot' },
  { id: 'path', label: 'Path' },
  { id: 'points', label: 'Dots' },
  { id: 'heat', label: 'Heatmap' }
];
const measures = Object.entries(heatMeasureLabels) as [HeatMeasure, string][];
// What a heatmap can measure: any number.
const numbers = computed(() => props.signals.filter((s) => s.kind === 'number' && s.count !== 0));
const trails = [0, 1, 2, 5, 10, 30];

// The field as a picture, for copying.
defineExpose({ image: () => fieldCanvas.value?.image() ?? null });
</script>

<template>
  <div class="field-panel">
    <div v-if="editing" class="panel-settings">
      <label>
        <span class="hint small">Field</span>
        <select :value="panel.season" aria-label="Field" @change="update({ season: ($event.target as HTMLSelectElement).value })">
          <option v-for="f in fieldImages" :key="f.season" :value="f.season">{{ f.season }} {{ f.game }}</option>
        </select>
      </label>
      <label>
        <span class="hint small">Robot size (m)</span>
        <input type="number" min="0.2" max="3" step="0.05" :value="panel.robotSize" aria-label="Robot size in metres"
          @change="update({ robotSize: Math.min(3, Math.max(0.2, Number(($event.target as HTMLInputElement).value) || 0.9)) })" />
      </label>
      <label>
        <span class="hint small">Trail</span>
        <select :value="panel.trail" aria-label="Trail" @change="update({ trail: Number(($event.target as HTMLSelectElement).value) })">
          <option v-for="t in trails" :key="t" :value="t">{{ t === 0 ? 'None' : `${t} s` }}</option>
        </select>
      </label>
    </div>

    <div class="field-tools">
      <button class="small-button" title="Turn the field 90° clockwise" @click="rotate">↻ Turn</button>
      <select v-if="panel.items.length < maxFieldItems" class="add-pose" value="" aria-label="Add a pose"
        @change="addItem(($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''">
        <option value="">{{ candidates.length ? '+ Add a pose…' : 'No poses in this log' }}</option>
        <option v-for="s in candidates" :key="s.key" :value="s.key" :disabled="panel.items.some((i) => i.key === s.key)">
          {{ labelOf(s.key) }} ({{ s.type.replace(/^struct:/, '') }})
        </option>
      </select>
      <span class="spacer"></span>
      <span v-if="pointer" class="hint small">{{ pointer.x.toFixed(2) }}, {{ pointer.y.toFixed(2) }} m</span>
    </div>

    <FieldCanvas ref="fieldCanvas" :items="canvasItems" :heat="heatLayers" :season="panel.season" :rotation="panel.rotation" :robot-size="panel.robotSize"
      :max-height="maxHeight" @pointer="pointer = $event" />
    <p v-if="error" class="error-text small">{{ error }}</p>

    <table v-if="panel.items.length" class="plain items">
      <tbody>
        <tr v-for="(row, i) in legend" :key="row.key">
          <td class="swatch-cell">
            <ColorPicker :color="row.color" :palette="themePalette" :label="row.key" @pick="updateItem(i, { color: $event })" />
          </td>
          <td class="name" :title="row.key">{{ row.label }}</td>
          <td>
            <select :value="panel.items[i].style" :aria-label="`How ${row.key} is drawn`"
              @change="updateItem(i, { style: ($event.target as HTMLSelectElement).value as FieldStyle })">
              <option v-for="s in styles" :key="s.id" :value="s.id">{{ s.label }}</option>
            </select>
          </td>
          <td v-if="panel.items[i].style === 'robot'">
            <input type="range" min="0" max="1" step="0.05" :value="panel.items[i].opacity" :aria-label="`Opacity of ${row.key}`"
              title="How solid the robot is" @input="updateItem(i, { opacity: Number(($event.target as HTMLInputElement).value) })" />
          </td>
          <td v-else-if="panel.items[i].style === 'heat'" class="heat-settings">
            <select :value="panel.items[i].measure ?? 'time'" :aria-label="`What the heatmap of ${row.key} measures`"
              @change="updateItem(i, { measure: ($event.target as HTMLSelectElement).value as HeatMeasure })">
              <option v-for="[id, label] in measures" :key="id" :value="id">{{ label }}</option>
            </select>
            <select v-if="(panel.items[i].measure ?? 'time') !== 'time'" :value="panel.items[i].value ?? ''" :aria-label="`The signal the heatmap of ${row.key} measures`"
              @change="updateItem(i, { value: ($event.target as HTMLSelectElement).value || undefined })">
              <option value="">Pick a signal (or click one in the list)…</option>
              <option v-for="s in numbers" :key="s.key" :value="s.key">{{ labelOf(s.key) }}</option>
            </select>
          </td>
          <td v-else></td>
          <td class="number small">{{ row.where }}</td>
          <td><button class="remove" :aria-label="`Remove ${row.key}`" @click="removeItem(i)">✕</button></td>
        </tr>
      </tbody>
    </table>
    <p v-else class="hint small">Add a pose: a robot's pose estimate, a vision measurement, a trajectory.</p>
    <p v-if="panel.items.some((i) => i.style === 'heat')" class="hint small">
      A heatmap is a point for each sample over the span shown, where the pose was then; where they pile up it's hot. It shows where
      the pose spent its time, a signal's average while it was there, or how much a counter (a camera's frames used, say) went up there.
    </p>
  </div>
</template>

<style scoped>
.field-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-tools {
  display: flex;
  align-items: center;
  gap: 8px;
}

.add-pose {
  min-width: 0;
  max-width: 60%;
}

.items td {
  padding: 3px 6px;
  vertical-align: middle;
}

.items .name {
  overflow-wrap: anywhere;
  font-size: 0.85rem;
}

.items input[type='range'] {
  width: 70px;
}

.heat-settings {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.heat-settings select {
  max-width: 220px;
}

.swatch-cell {
  width: 1px;
}
</style>
