<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import {
  isPoseType,
  maxFieldItems,
  maxPanels,
  maxPieKeys,
  panelLabels,
  type PanelType,
  type PlotPanel,
  type RobotModel
} from '@shared/plots';
import type { SignalInfo } from '@shared/signals';
import ConsolePanel from '@/components/ConsolePanel.vue';
import FieldPanel from '@/components/FieldPanel.vue';
import PiePanel from '@/components/PiePanel.vue';
import Robot3dPanel from '@/components/Robot3dPanel.vue';
import { usePlotStore } from '@/stores/plot-store';

// The other plots under the chart (#144): a field, the console, pies and
// the robot in 3D, each at the moment the chart shows (the pin, the
// playhead, or now), over the span it shows.

const props = defineProps<{
  session: string;
  signals: SignalInfo[];
  time: number;
  span: [number, number];
  following: boolean;
  dark: boolean;
  // The season of the log open, for a new field.
  season: string;
}>();

const emit = defineEmits<{
  // A moment picked in a plot (a console line): pin it.
  seek: [time: number];
}>();

const plotStore = usePlotStore();
const message = ref('');
const types: PanelType[] = ['field', 'console', 'pie', 'robot3d'];

// Settings are open on a new plot, and when asked for.
const editing = ref(new Set<string>());
function toggleEditing(id: string) {
  const next = new Set(editing.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  editing.value = next;
}

function add(type: PanelType) {
  message.value = plotStore.addPanel(type, props.season);
  const added = plotStore.panels[plotStore.panels.length - 1];
  if (!message.value && added) toggleEditing(added.id);
}

function update(panel: PlotPanel) {
  plotStore.updatePanel(JSON.parse(JSON.stringify(panel)) as PlotPanel);
}

// --- Robot models, for the 3D robot ---

const models = ref<RobotModel[]>([]);
const wantsModels = computed(() => plotStore.panels.some((p) => p.type === 'robot3d'));
async function loadModels() {
  models.value = await window.diagnostics.getRobotModels().catch(() => []);
}
onMounted(() => {
  if (wantsModels.value) void loadModels();
});
watch(wantsModels, (wanted) => {
  if (wanted) void loadModels();
});

async function addModel(panel: PlotPanel) {
  const added = await window.diagnostics.addRobotModel();
  if (added === null) return;
  if (typeof added === 'string') {
    message.value = added;
    return;
  }
  message.value = '';
  await loadModels();
  if (panel.type === 'robot3d') update({ ...panel, model: added.id });
}

// --- Dropping a signal from the list onto a plot ---

const dragType = 'application/x-diagnostics-signal';
const dropOn = ref('');
const byKey = computed(() => new Map(props.signals.map((s) => [s.key, s])));

function onDragOver(event: DragEvent, panel: PlotPanel) {
  if (!event.dataTransfer?.types.includes(dragType)) return;
  event.preventDefault();
  event.stopPropagation();
  dropOn.value = panel.id;
}

function onDrop(event: DragEvent, panel: PlotPanel) {
  dropOn.value = '';
  const signal = byKey.value.get(event.dataTransfer?.getData(dragType) ?? '');
  if (!signal) return;
  event.preventDefault();
  event.stopPropagation();
  message.value = '';
  switch (panel.type) {
    case 'console':
      if (signal.kind !== 'string') message.value = 'The console shows text signals.';
      else update({ ...panel, key: signal.key });
      return;
    case 'pie':
      if (panel.mode === 'states') update({ ...panel, keys: [signal.key] });
      else if (signal.kind !== 'number') message.value = "A pie of shares is of numbers. Choose 'Time at each value' in its settings for states.";
      else if (!panel.keys.includes(signal.key)) update({ ...panel, keys: [...panel.keys, signal.key].slice(0, maxPieKeys) });
      return;
    case 'field': {
      const pose = signal.parent ? byKey.value.get(signal.parent) : signal;
      if (!pose || !isPoseType(pose.type)) message.value = 'The field shows poses: Pose2d, Pose3d, and lists of them.';
      else if (!panel.items.some((i) => i.key === pose.key) && panel.items.length < maxFieldItems) {
        const used = new Set(panel.items.map((i) => i.color));
        const color = [...Array(maxFieldItems).keys()].find((slot) => !used.has(slot)) ?? 0;
        update({ ...panel, items: [...panel.items, { key: pose.key, style: 'robot', color, opacity: 0.3 }] });
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

// --- Copying a plot as a picture ---

const panelRefs = ref<Record<string, { image?: () => HTMLCanvasElement | null } | null>>({});
const copied = ref('');
async function copyImage(id: string) {
  const canvas = panelRefs.value[id]?.image?.();
  if (!canvas) return;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return;
  const problem = await window.diagnostics.copyImage(new Uint8Array(await blob.arrayBuffer()));
  message.value = problem;
  copied.value = problem ? '' : id;
  setTimeout(() => { if (copied.value === id) copied.value = ''; }, 1500);
}

function title(panel: PlotPanel): string {
  if (panel.type === 'console') return `Console${panel.key && panel.key !== 'console' ? `: ${panel.key}` : ''}`;
  if (panel.type === 'pie') return panel.mode === 'share' ? 'Pie: shares of the total' : 'Pie: time at each value';
  return panelLabels[panel.type];
}
</script>

<template>
  <div class="plot-panels">
    <div class="add-row">
      <span class="hint small">Add a plot</span>
      <button v-for="type in types" :key="type" :id="`add-${type}`" class="chip" :disabled="plotStore.panels.length >= maxPanels" @click="add(type)">
        + {{ panelLabels[type] }}
      </button>
    </div>
    <p v-if="message" class="error-text small">{{ message }}</p>

    <div v-if="plotStore.panels.length" class="panel-grid">
      <section v-for="(panel, i) in plotStore.panels" :key="panel.id" class="plot-panel" :class="[panel.type, { over: dropOn === panel.id }]"
        :data-panel="panel.type" @dragover="onDragOver($event, panel)" @dragleave="dropOn = ''" @drop="onDrop($event, panel)">
        <header class="panel-head">
          <strong>{{ title(panel) }}</strong>
          <span class="spacer"></span>
          <button v-if="panel.type === 'field' || panel.type === 'robot3d'" class="icon" :title="copied === panel.id ? 'Copied' : 'Copy as an image'"
            :aria-label="`Copy the ${panelLabels[panel.type]} as an image`" @click="copyImage(panel.id)">{{ copied === panel.id ? '✓' : '⧉' }}</button>
          <button class="icon" :aria-pressed="editing.has(panel.id)" title="Settings" :aria-label="`Settings for the ${panelLabels[panel.type]}`"
            @click="toggleEditing(panel.id)">⚙</button>
          <button class="icon" :disabled="i === 0" title="Move earlier" aria-label="Move earlier" @click="plotStore.movePanel(panel.id, -1)">↑</button>
          <button class="icon" :disabled="i === plotStore.panels.length - 1" title="Move later" aria-label="Move later" @click="plotStore.movePanel(panel.id, 1)">↓</button>
          <button class="icon" title="Remove" :aria-label="`Remove the ${panelLabels[panel.type]}`" @click="plotStore.removePanel(panel.id)">✕</button>
        </header>
        <FieldPanel v-if="panel.type === 'field'" :ref="(el) => { panelRefs[panel.id] = el as never; }" :panel="panel" :session="session"
          :signals="signals" :time="time" :span="span" :dark="dark" :editing="editing.has(panel.id)" @update="update" />
        <ConsolePanel v-else-if="panel.type === 'console'" :panel="panel" :session="session" :signals="signals" :time="time" :span="span"
          :following="following" :editing="editing.has(panel.id)" @update="update" @seek="emit('seek', $event)" />
        <PiePanel v-else-if="panel.type === 'pie'" :panel="panel" :session="session" :signals="signals" :span="span" :dark="dark"
          :editing="editing.has(panel.id)" @update="update" />
        <Robot3dPanel v-else-if="panel.type === 'robot3d'" :ref="(el) => { panelRefs[panel.id] = el as never; }" :panel="panel" :session="session"
          :signals="signals" :time="time" :span="span" :dark="dark" :editing="editing.has(panel.id)" :models="models" @update="update"
          @add-model="addModel(panel)" />
      </section>
    </div>
  </div>
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

.plot-panels .chip {
  padding: 2px 10px;
  border: 1px solid rgba(127, 127, 127, 0.6);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}

.plot-panels .chip[aria-pressed='true'] {
  border-color: #2a78d6;
  background: color-mix(in srgb, #2a78d6 18%, transparent);
}

.plot-panels .chip:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>

<style scoped>
.plot-panels {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.add-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.panel-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(440px, 1fr));
  gap: 12px;
}

.plot-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid rgba(127, 127, 127, 0.35);
  border-radius: 10px;
}

.plot-panel.over {
  border-color: #2a78d6;
  background: color-mix(in srgb, #2a78d6 8%, transparent);
}

.panel-head {
  display: flex;
  align-items: center;
  gap: 4px;
}

.icon {
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.icon:hover:not(:disabled) {
  border-color: rgba(127, 127, 127, 0.6);
}

.icon[aria-pressed='true'] {
  border-color: #2a78d6;
}

.icon:disabled {
  opacity: 0.35;
  cursor: default;
}
</style>
