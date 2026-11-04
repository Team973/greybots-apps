<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import {
  isPoseType,
  isSinglePoseType,
  maxFieldItems,
  posesFrom,
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
import { fieldFor, fieldImages } from '@/fields';
import { palette } from '@/palette';
import { useRecords } from '@/panel-data';

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

// Enough to draw trails behind the moment shown, and paths over the span.
const readSpan = computed<[number, number]>(() => [
  Math.min(props.span[0], props.time - props.panel.trail),
  Math.max(props.span[1], props.time)
]);
const keys = computed(() => props.panel.items.map((item) => item.key));
const { records, error } = useRecords(computed(() => props.session), keys, readSpan);

interface Drawn {
  item: FieldItem;
  type: string;
  // At the moment shown.
  poses: Pose[];
  // A single pose's, over the trail (robots, dots) or the span (paths).
  history: Pose[];
}

const drawn = computed<Drawn[]>(() => props.panel.items.map((item) => {
  const found = records.value.get(item.key);
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

const box = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const width = ref(600);
const field = computed(() => fieldFor(props.panel.season));
// A little of what's around the field shows too.
const margin = 0.4;
const turned = computed(() => props.panel.rotation === 90 || props.panel.rotation === 270);
const viewLength = computed(() => field.value.length + 2 * margin);
const viewWidth = computed(() => field.value.width + 2 * margin);
// As big as fits the width, and the height it's given.
const across = computed(() => (turned.value ? viewWidth.value : viewLength.value));
const down = computed(() => (turned.value ? viewLength.value : viewWidth.value));
const scale = computed(() => Math.min(width.value / across.value, (props.maxHeight ?? Infinity) / down.value));
const drawWidth = computed(() => scale.value * across.value);
const height = computed(() => scale.value * down.value);

const image = new Image();
const imageReady = ref(false);
watch(field, (f) => {
  imageReady.value = false;
  image.onload = () => { imageReady.value = true; };
  image.src = f.image;
}, { immediate: true });

let toField: DOMMatrix | null = null;

function draw() {
  const element = canvas.value;
  if (!element) return;
  const ratio = window.devicePixelRatio || 1;
  element.width = Math.round(drawWidth.value * ratio);
  element.height = Math.round(height.value * ratio);
  const ctx = element.getContext('2d');
  if (!ctx) return;
  const f = field.value;
  const s = scale.value;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, drawWidth.value, height.value);
  // The field's middle at the canvas's, turned, metres to pixels with y up.
  ctx.translate(drawWidth.value / 2, height.value / 2);
  ctx.rotate((props.panel.rotation * Math.PI) / 180);
  const X = (x: number) => (x - f.length / 2) * s;
  const Y = (y: number) => -(y - f.width / 2) * s;
  toField = ctx.getTransform().inverse();

  if (imageReady.value) {
    const pxPerMetreX = (f.right - f.left) / f.length;
    const pxPerMetreY = (f.bottom - f.top) / f.width;
    // Turned about the field's middle (fields.ts).
    ctx.save();
    ctx.rotate(Math.PI);
    ctx.drawImage(image, X(-f.left / pxPerMetreX), Y(f.bottom / pxPerMetreY), (image.width / pxPerMetreX) * s, (image.height / pxPerMetreY) * s);
    ctx.restore();
  }

  const robot = props.panel.robotSize * s;
  for (const { item, poses, history } of drawn.value) {
    const color = colorOf(item.color);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Where it's been (or, for a path, where it went over the span).
    if (history.length > 1 && item.style !== 'points') {
      ctx.globalAlpha = item.style === 'path' ? 0.9 : 0.6;
      ctx.lineWidth = 2;
      ctx.beginPath();
      history.forEach((p, i) => (i === 0 ? ctx.moveTo(X(p.x), Y(p.y)) : ctx.lineTo(X(p.x), Y(p.y))));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    if (item.style === 'path' && poses.length > 1) {
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      poses.forEach((p, i) => (i === 0 ? ctx.moveTo(X(p.x), Y(p.y)) : ctx.lineTo(X(p.x), Y(p.y))));
      ctx.stroke();
    }
    if (item.style === 'points') {
      for (const p of [...history, ...poses]) {
        ctx.beginPath();
        ctx.arc(X(p.x), Y(p.y), 4, 0, Math.PI * 2);
        ctx.fill();
      }
      continue;
    }
    if (item.style === 'path') {
      // Where it is now, on its path.
      const now = poses.length === 1 ? poses[0] : null;
      if (now) {
        ctx.beginPath();
        ctx.arc(X(now.x), Y(now.y), 5, 0, Math.PI * 2);
        ctx.fill();
      }
      continue;
    }
    for (const pose of poses) {
      ctx.save();
      ctx.translate(X(pose.x), Y(pose.y));
      ctx.rotate(-yawOf(pose));
      // A black body in bumpers of its colour, the whole of it as see-through
      // as it's set, so the arrow shows however solid it is.
      ctx.globalAlpha = item.opacity;
      ctx.fillStyle = '#000';
      ctx.fillRect(-robot / 2, -robot / 2, robot, robot);
      ctx.lineWidth = 3;
      ctx.strokeRect(-robot / 2, -robot / 2, robot, robot);
      if (pose.heading) {
        // Which way is the front: a white line from the middle to it, and a notch.
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(robot / 2, 0);
        ctx.moveTo(robot / 2 - robot * 0.18, -robot * 0.18);
        ctx.lineTo(robot / 2, 0);
        ctx.lineTo(robot / 2 - robot * 0.18, robot * 0.18);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

watch([drawn, drawWidth, height, imageReady, () => props.panel.rotation, () => props.panel.robotSize, () => props.dark], () => requestAnimationFrame(draw));

let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver(() => {
    if (box.value) width.value = Math.max(200, box.value.clientWidth);
  });
  if (box.value) observer.observe(box.value);
  draw();
});
onUnmounted(() => observer?.disconnect());

// Where the pointer is, in field metres.
const pointer = ref<{ x: number; y: number } | null>(null);
function onMove(event: MouseEvent) {
  if (!toField || !canvas.value) return;
  const rect = canvas.value.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const at = toField.transformPoint(new DOMPoint((event.clientX - rect.left) * ratio, (event.clientY - rect.top) * ratio));
  const f = field.value;
  pointer.value = { x: at.x / scale.value + f.length / 2, y: -at.y / scale.value + f.width / 2 };
}

const legend = computed(() => drawn.value.map(({ item, poses }) => {
  const pose = poses.length === 1 ? poses[0] : null;
  const where = pose
    ? `${pose.x.toFixed(2)}, ${pose.y.toFixed(2)} m${pose.heading ? `, ${((yawOf(pose) * 180) / Math.PI).toFixed(0)}°` : ''}`
    : poses.length > 1 ? `${poses.length} poses` : '—';
  return { key: item.key, color: colorOf(item.color), label: labelOf(item.key), where };
}));

const styles: { id: FieldStyle; label: string }[] = [
  { id: 'robot', label: 'Robot' },
  { id: 'path', label: 'Path' },
  { id: 'points', label: 'Dots' }
];
const trails = [0, 1, 2, 5, 10, 30];

// The field as a picture, for copying.
defineExpose({ image: () => canvas.value });
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

    <div ref="box" class="field-box">
      <canvas ref="canvas" :style="{ width: `${drawWidth}px`, height: `${height}px` }" @mousemove="onMove" @mouseleave="pointer = null"></canvas>
    </div>
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
          <td v-else></td>
          <td class="number small">{{ row.where }}</td>
          <td><button class="remove" :aria-label="`Remove ${row.key}`" @click="removeItem(i)">✕</button></td>
        </tr>
      </tbody>
    </table>
    <p v-else class="hint small">Add a pose: a robot's pose estimate, a vision measurement, a trajectory.</p>
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

.field-box {
  width: 100%;
}

canvas {
  display: block;
  margin: 0 auto;
  border-radius: 6px;
  cursor: crosshair;
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

.swatch-cell {
  width: 1px;
}
</style>
