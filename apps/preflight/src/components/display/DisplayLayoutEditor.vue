<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import AutosaveStatus from '@/components/AutosaveStatus.vue';
import { useAutosave } from '@/lib/autosave';
import {
  defaultDisplayConfig,
  displayPhases,
  displayWidgetLabels,
  displayWidgets,
  getDisplayConfig,
  saveDisplayConfig,
  type DisplayConfig,
  type DisplayPhase,
  type DisplayWidget
} from '@/lib/display/display';
import { useLiveQuery } from '@/lib/live-query';
import { phaseLabels } from '@/lib/schedule/types';
import { useSessionStore } from '@/stores/session-store';

// Chooses what the pit display shows above the robot status, per event phase
// (issue #90). Saved automatically as a shared setting.
defineProps<{ canEdit: boolean }>();
const session = useSessionStore();

const remote = useLiveQuery<DisplayConfig | null>(getDisplayConfig, null);
const config = ref<DisplayConfig>(defaultDisplayConfig());
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const autosave = useAutosave(() => config.value, (value) => saveDisplayConfig(clone(value), session.user?.name ?? null), {
  enabled: () => session.hasRole('lead') && remote.value !== null
});
watch(
  remote,
  (value) => {
    if (value === null || ['pending', 'saving', 'error'].includes(autosave.state.value)) return;
    config.value = clone(value);
    autosave.reset();
  },
  { immediate: true }
);

const phaseName = (phase: DisplayPhase) => (phase === 'default' ? 'Default (phase unknown)' : phaseLabels[phase]);
const editing = ref<DisplayPhase>('default');
const shown = computed(() => config.value.layouts[editing.value]);
const hidden = computed(() => displayWidgets.filter((w) => !shown.value.includes(w)));

function add(widget: DisplayWidget) {
  config.value.layouts[editing.value] = [...shown.value, widget];
}

function remove(index: number) {
  config.value.layouts[editing.value] = shown.value.filter((_, i) => i !== index);
}

function move(index: number, delta: number) {
  const list = [...shown.value];
  const target = index + delta;
  if (target < 0 || target >= list.length) return;
  [list[index], list[target]] = [list[target], list[index]];
  config.value.layouts[editing.value] = list;
}
</script>

<template>
  <section class="panel">
    <header class="panel-header">
      <h2>Pit display</h2>
      <AutosaveStatus v-if="canEdit" :state="autosave.state.value" :error="autosave.error.value" />
    </header>
    <p class="hint">
      The big screen always shows the robot status along the bottom. Choose what goes above it in each phase of the event.
      <RouterLink to="/display" class="panel-link">Open the pit display →</RouterLink>
    </p>

    <label class="field">
      <span>Show the layout for</span>
      <select v-model="config.phase_override" :disabled="!canEdit">
        <option :value="null">The current phase (from the event timeline)</option>
        <option v-for="phase in displayPhases" :key="phase" :value="phase">Always: {{ phaseName(phase) }}</option>
      </select>
    </label>

    <label class="field">
      <span>Layout to edit</span>
      <select v-model="editing">
        <option v-for="phase in displayPhases" :key="phase" :value="phase">{{ phaseName(phase) }}</option>
      </select>
    </label>

    <ol class="widgets">
      <li v-for="(widget, i) in shown" :key="widget">
        <span class="name">{{ displayWidgetLabels[widget] }}</span>
        <template v-if="canEdit">
          <button class="icon-small" :disabled="i === 0" :aria-label="`Move ${displayWidgetLabels[widget]} up`" @click="move(i, -1)">↑</button>
          <button class="icon-small" :disabled="i === shown.length - 1" :aria-label="`Move ${displayWidgetLabels[widget]} down`" @click="move(i, 1)">↓</button>
          <button class="icon-small" :aria-label="`Remove ${displayWidgetLabels[widget]}`" @click="remove(i)">✕</button>
        </template>
      </li>
    </ol>
    <p v-if="!shown.length" class="hint">Nothing but the robot status.</p>
    <div v-if="canEdit && hidden.length" class="add">
      <button v-for="widget in hidden" :key="widget" class="chip" @click="add(widget)">+ {{ displayWidgetLabels[widget] }}</button>
    </div>
  </section>
</template>

<style scoped>
.hint {
  margin: 0;
  opacity: 0.7;
  font-size: 0.9rem;
}

/* .field is sized for form rows; here each one is a full-width block. */
.field {
  flex: none;
}

.widgets {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.widgets li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 4px 4px 10px;
  border-radius: 8px;
  border: 1px solid var(--accent-color);
  background: var(--background-color);
}

.name {
  flex: 1;
  min-width: 0;
}

.add {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.chip {
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px dashed var(--accent-color);
  background: transparent;
  color: var(--primary-text-color);
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}
</style>
