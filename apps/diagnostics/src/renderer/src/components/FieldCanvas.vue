<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import { yawOf, type FieldRotation, type FieldStyle, type Pose } from '@shared/plots';
import { fieldFor } from '@/fields';

// The field, and poses drawn on it: robots as squares the size of one, with
// their heading and where they've been behind them; paths; dots. Only draws
// what it's given (the Signals page's field panel reads the log; a report
// keeps its own poses).

export interface CanvasItem {
  key: string;
  color: string;
  style: FieldStyle;
  // How solid a robot is.
  opacity: number;
  // At the moment shown.
  poses: Pose[];
  // A single pose's, over its trail (robots, dots) or the span (paths).
  history: Pose[];
  // Drawn as an outline only (a robot it's being compared with).
  outline?: boolean;
}

const props = defineProps<{
  items: CanvasItem[];
  season: string;
  rotation: FieldRotation;
  robotSize: number;
  // The most the field may take up and down, pixels.
  maxHeight?: number;
}>();

const emit = defineEmits<{
  // Where the pointer is, in field metres, or null off the field.
  pointer: [at: { x: number; y: number } | null];
}>();

const box = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const width = ref(600);
const field = computed(() => fieldFor(props.season));
// A little of what's around the field shows too.
const margin = 0.4;
const turned = computed(() => props.rotation === 90 || props.rotation === 270);
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
  ctx.rotate((props.rotation * Math.PI) / 180);
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

  const robot = props.robotSize * s;
  for (const { color, style, opacity, poses, history, outline } of props.items) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Where it's been (or, for a path, where it went over the span).
    if (history.length > 1 && style !== 'points') {
      ctx.globalAlpha = style === 'path' ? 0.9 : 0.6;
      ctx.lineWidth = 2;
      ctx.beginPath();
      history.forEach((p, i) => (i === 0 ? ctx.moveTo(X(p.x), Y(p.y)) : ctx.lineTo(X(p.x), Y(p.y))));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    if (style === 'path' && poses.length > 1) {
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      poses.forEach((p, i) => (i === 0 ? ctx.moveTo(X(p.x), Y(p.y)) : ctx.lineTo(X(p.x), Y(p.y))));
      ctx.stroke();
    }
    if (style === 'points') {
      for (const p of [...history, ...poses]) {
        ctx.beginPath();
        ctx.arc(X(p.x), Y(p.y), 4, 0, Math.PI * 2);
        ctx.fill();
      }
      continue;
    }
    if (style === 'path') {
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
      // as it's set, so the arrow shows however solid it is. An outline is
      // its bumpers only, so what's under it shows.
      ctx.globalAlpha = opacity;
      if (!outline) {
        ctx.fillStyle = '#000';
        ctx.fillRect(-robot / 2, -robot / 2, robot, robot);
      }
      ctx.lineWidth = 3;
      ctx.strokeRect(-robot / 2, -robot / 2, robot, robot);
      if (pose.heading) {
        // Which way is the front: a line from the middle to it, and a notch.
        ctx.strokeStyle = outline ? color : '#fff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(robot / 2, 0);
        ctx.moveTo(robot / 2 - robot * 0.18, -robot * 0.18);
        ctx.lineTo(robot / 2, 0);
        ctx.lineTo(robot / 2 - robot * 0.18, robot * 0.18);
        ctx.stroke();
      } else if (outline) {
        // No heading: a dot at its middle.
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
}

watch([() => props.items, drawWidth, height, imageReady, () => props.rotation, () => props.robotSize], () => requestAnimationFrame(draw));

let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver(() => {
    if (box.value) width.value = Math.max(200, box.value.clientWidth);
  });
  if (box.value) observer.observe(box.value);
  draw();
});
onUnmounted(() => observer?.disconnect());

function onMove(event: MouseEvent) {
  if (!toField || !canvas.value) return;
  const rect = canvas.value.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const at = toField.transformPoint(new DOMPoint((event.clientX - rect.left) * ratio, (event.clientY - rect.top) * ratio));
  const f = field.value;
  emit('pointer', { x: at.x / scale.value + f.length / 2, y: -at.y / scale.value + f.width / 2 });
}

// The field as a picture, for copying.
defineExpose({ image: () => canvas.value });
</script>

<template>
  <div ref="box" class="field-box">
    <canvas ref="canvas" :style="{ width: `${drawWidth}px`, height: `${height}px` }" @mousemove="onMove" @mouseleave="emit('pointer', null)"></canvas>
  </div>
</template>

<style scoped>
.field-box {
  width: 100%;
}

canvas {
  display: block;
  margin: 0 auto;
  border-radius: 6px;
  cursor: crosshair;
}
</style>
