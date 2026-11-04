<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import { isPoseType, maxFieldItems, maxPieKeys, panelKeys, panelLabels, type PlotPanel, type RobotModel } from '@shared/plots';
import type { SignalInfo } from '@shared/signals';
import ConsolePanel from '@/components/ConsolePanel.vue';
import FieldPanel from '@/components/FieldPanel.vue';
import PiePanel from '@/components/PiePanel.vue';
import Robot3dPanel from '@/components/Robot3dPanel.vue';
import { usePlotStore } from '@/stores/plot-store';

// One of the other plots (#144), in its tab where the line chart is: a
// field, the console, a pie or the robot in 3D, at the moment the chart
// shows (the pin, the playhead, or now) over the span it shows.

const props = defineProps<{
  panel: PlotPanel;
  session: string;
  signals: SignalInfo[];
  time: number;
  span: [number, number];
  following: boolean;
  dark: boolean;
  // As tall as the line chart.
  height: number;
}>();

const emit = defineEmits<{
  // A moment picked in the plot (a console line): pin it.
  seek: [time: number];
}>();

const plotStore = usePlotStore();
const message = ref('');

// Settings start open on a plot that shows nothing yet.
const editing = ref(panelKeys(props.panel).length === 0);
watch(() => props.panel.id, () => {
  editing.value = panelKeys(props.panel).length === 0;
  message.value = '';
});

function update(panel: PlotPanel) {
  plotStore.updatePanel(JSON.parse(JSON.stringify(panel)) as PlotPanel);
}

// --- Robot models, for the 3D robot ---

const models = ref<RobotModel[]>([]);
async function loadModels() {
  models.value = await window.diagnostics.getRobotModels().catch(() => []);
}
onMounted(() => {
  if (props.panel.type === 'robot3d') void loadModels();
});
watch(() => props.panel.type, (type) => {
  if (type === 'robot3d') void loadModels();
});

async function addModel() {
  const added = await window.diagnostics.addRobotModel();
  if (added === null) return;
  if (typeof added === 'string') {
    message.value = added;
    return;
  }
  message.value = '';
  await loadModels();
  if (props.panel.type === 'robot3d') update({ ...props.panel, model: added.id });
}

// --- Dropping a signal from the list onto the plot ---

const dragType = 'application/x-diagnostics-signal';
const over = ref(false);
const byKey = computed(() => new Map(props.signals.map((s) => [s.key, s])));

function onDragOver(event: DragEvent) {
  if (!event.dataTransfer?.types.includes(dragType)) return;
  event.preventDefault();
  over.value = true;
}

function onDrop(event: DragEvent) {
  over.value = false;
  const signal = byKey.value.get(event.dataTransfer?.getData(dragType) ?? '');
  if (!signal) return;
  event.preventDefault();
  add(signal);
}

// A signal dropped here, or clicked in the list while this tab's shown.
function add(signal: SignalInfo) {
  message.value = '';
  const panel = props.panel;
  switch (panel.type) {
    case 'console':
      if (signal.kind !== 'string') message.value = 'The console shows text signals.';
      else update({ ...panel, key: signal.key });
      return;
    case 'pie':
      if (panel.mode === 'states') update({ ...panel, keys: [signal.key] });
      else if (signal.kind !== 'number') message.value = "A pie of shares is of numbers. Choose 'Time at each value' in its settings for states.";
      else if (!panel.keys.includes(signal.key)) update({ ...panel, keys: [...panel.keys, signal.key].slice(0, maxPieKeys - panel.groups.length) });
      return;
    case 'field': {
      // A pose's field (its x, say) stands for the pose.
      const pose = signal.parent ? byKey.value.get(signal.parent) : signal;
      if (!pose || !isPoseType(pose.type)) message.value = 'The field shows poses: Pose2d, Pose3d, and lists of them.';
      else if (!panel.items.some((i) => i.key === pose.key) && panel.items.length < maxFieldItems) {
        const used = new Set(panel.items.map((i) => i.color));
        const color = [...Array(maxFieldItems).keys()].find((slot) => !used.has(slot)) ?? 0;
        update({ ...panel, items: [...panel.items, { key: pose.key, style: 'robot', color, opacity: 1 }] });
      }
      return;
    }
    case 'robot3d': {
      const pose = signal.parent ? byKey.value.get(signal.parent) : signal;
      if (pose && /^struct:(Pose2d|Pose3d)$/.test(pose.type)) update({ ...panel, poseKey: pose.key });
      else message.value = "The 3D robot's pose is a Pose2d or a Pose3d.";
    }
  }
}
defineExpose({ add });

// --- Copying the plot as a picture ---

const view = ref<{ image?: () => HTMLCanvasElement | null } | null>(null);
const copied = ref(false);
async function copyImage() {
  const canvas = view.value?.image?.();
  if (!canvas) return;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return;
  const problem = await window.diagnostics.copyImage(new Uint8Array(await blob.arrayBuffer()));
  message.value = problem;
  copied.value = !problem;
  setTimeout(() => { copied.value = false; }, 1500);
}
</script>

<template>
  <section class="plot-panel" :class="[panel.type, { over }]" :data-panel="panel.type" :style="{ minHeight: `${height}px` }"
    @dragover="onDragOver" @dragleave="over = false" @drop="onDrop">
    <div class="panel-head">
      <span class="hint small">Drag a signal here to add it.</span>
      <span class="spacer"></span>
      <button v-if="panel.type === 'field' || panel.type === 'robot3d'" class="small-button" :title="copied ? 'Copied' : 'Copy as an image'"
        :aria-label="`Copy the ${panelLabels[panel.type]} as an image`" @click="copyImage">{{ copied ? 'Copied' : 'Copy image' }}</button>
      <button class="small-button" :aria-pressed="editing" :aria-label="`Settings for the ${panelLabels[panel.type]}`" @click="editing = !editing">
        ⚙ Settings
      </button>
    </div>
    <p v-if="message" class="error-text small">{{ message }}</p>
    <FieldPanel v-if="panel.type === 'field'" ref="view" :panel="panel" :session="session" :signals="signals" :time="time" :span="span"
      :dark="dark" :editing="editing" :max-height="height - 120" @update="update" />
    <ConsolePanel v-else-if="panel.type === 'console'" :panel="panel" :session="session" :signals="signals" :time="time" :span="span"
      :following="following" :editing="editing" :height="height - 80" @update="update" @seek="emit('seek', $event)" />
    <PiePanel v-else-if="panel.type === 'pie'" :panel="panel" :session="session" :signals="signals" :span="span" :dark="dark"
      :editing="editing" @update="update" />
    <Robot3dPanel v-else-if="panel.type === 'robot3d'" ref="view" :panel="panel" :session="session" :signals="signals" :time="time"
      :span="span" :dark="dark" :editing="editing" :models="models" :height="height - 90" @update="update" @add-model="addModel" />
  </section>
</template>

<style>
/* Shared by the plots inside. */
.plot-panel .panel-settings {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 8px;
  border-radius: 6px;
  background: rgba(127, 127, 127, 0.08);
}

.plot-panel .panel-settings label {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.plot-panel select,
.plot-panel input[type='number'] {
  padding: 4px 6px;
  border: 1px solid rgba(127, 127, 127, 0.6);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
}

.plot-panel input[type='number'] {
  width: 5em;
}

.plot-panel select option {
  background: var(--tile-background-color, Canvas);
}

.plot-panel .small {
  font-size: 0.85rem;
}

.plot-panel .spacer {
  flex: 1;
}

.plot-panel .small-button {
  padding: 4px 10px;
  border: 1px solid rgba(127, 127, 127, 0.6);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
  white-space: nowrap;
}

.plot-panel .small-button[aria-pressed='true'] {
  border-color: #2a78d6;
  background: color-mix(in srgb, #2a78d6 18%, transparent);
}

.plot-panel .remove {
  border: none;
  background: transparent;
  color: inherit;
  opacity: 0.6;
  cursor: pointer;
}

.plot-panel .remove:hover {
  opacity: 1;
}

.plot-panel .chip {
  padding: 2px 10px;
  border: 1px solid rgba(127, 127, 127, 0.6);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}

.plot-panel .chip[aria-pressed='true'] {
  border-color: #2a78d6;
  background: color-mix(in srgb, #2a78d6 18%, transparent);
}
</style>

<style scoped>
.plot-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  box-sizing: border-box;
  border: 1px dashed transparent;
  border-radius: 8px;
}

.plot-panel.over {
  border-color: #2a78d6;
  background: color-mix(in srgb, #2a78d6 6%, transparent);
}

.panel-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
