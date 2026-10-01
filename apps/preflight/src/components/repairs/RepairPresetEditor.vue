<script setup lang="ts">
import { ref, watch } from 'vue';
import AutosaveStatus from '@/components/AutosaveStatus.vue';
import { useAutosave } from '@/lib/autosave';
import { useLiveQuery } from '@/lib/live-query';
import { defaultRepairPresets, getRepairPresets, saveRepairPresets, type RepairPreset } from '@/lib/repairs/presets';
import { subsystemSuggestions } from '@/lib/subsystems';
import { useSessionStore } from '@/stores/session-store';

// Edits the quick-create options offered when logging a repair (Pit setup).
// Saved automatically as a shared setting.
defineProps<{ canEdit: boolean }>();
const session = useSessionStore();

const remote = useLiveQuery<RepairPreset[] | null>(getRepairPresets, null);
const presets = ref<RepairPreset[]>([]);
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const autosave = useAutosave(() => presets.value, (value) => saveRepairPresets(clone(value), session.user?.name ?? null), {
  enabled: () => session.hasRole('lead') && remote.value !== null,
  validate: (value) => (value.some((p) => !p.title.trim()) ? 'Every common repair needs a name' : null)
});
watch(
  remote,
  (value) => {
    if (value === null || ['pending', 'saving', 'error'].includes(autosave.state.value)) return;
    presets.value = clone(value);
    autosave.reset();
  },
  { immediate: true }
);

function add() {
  presets.value.push({ id: crypto.randomUUID(), title: '', subsystem: '' });
}

function move(index: number, delta: number) {
  const target = index + delta;
  if (target < 0 || target >= presets.value.length) return;
  const [item] = presets.value.splice(index, 1);
  presets.value.splice(target, 0, item);
}

function restoreDefaults() {
  if (presets.value.length && !confirm('Replace the list with the suggested common repairs?')) return;
  presets.value = defaultRepairPresets();
}
</script>

<template>
  <section class="panel">
    <header class="panel-header">
      <h2>Common repairs</h2>
      <AutosaveStatus v-if="canEdit" :state="autosave.state.value" :error="autosave.error.value" />
    </header>
    <p class="hint">Offered as one-tap options when logging a repair. Each fills in what's being repaired and its subsystem.</p>

    <ul class="presets">
      <li v-for="(preset, i) in presets" :key="preset.id">
        <input v-model="preset.title" class="title" :readonly="!canEdit" placeholder="Repair" aria-label="Repair" />
        <input v-model="preset.subsystem" class="subsystem" list="preset-subsystems" :readonly="!canEdit" placeholder="Subsystem" aria-label="Subsystem" />
        <template v-if="canEdit">
          <button class="icon-small" :disabled="i === 0" :aria-label="`Move ${preset.title || 'repair'} up`" @click="move(i, -1)">↑</button>
          <button class="icon-small" :disabled="i === presets.length - 1" :aria-label="`Move ${preset.title || 'repair'} down`" @click="move(i, 1)">↓</button>
          <button class="icon-small" :aria-label="`Remove ${preset.title || 'repair'}`" @click="presets.splice(i, 1)">✕</button>
        </template>
      </li>
    </ul>
    <datalist id="preset-subsystems"><option v-for="s in subsystemSuggestions" :key="s" :value="s" /></datalist>
    <p v-if="!presets.length" class="hint">None. Repairs are typed in by hand.</p>
    <div v-if="canEdit" class="add-row">
      <button class="add-link" @click="add">+ Add common repair</button>
      <button class="add-link" @click="restoreDefaults">Use the suggested list</button>
    </div>
  </section>
</template>

<style scoped>
.hint {
  margin: 0;
  opacity: 0.7;
  font-size: 0.9rem;
}

.presets {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.presets li {
  display: flex;
  align-items: center;
  gap: 6px;
}

.presets input {
  min-width: 0;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--accent-color);
  background: var(--background-color);
  color: var(--primary-text-color);
  font: inherit;
  font-size: 0.95rem;
}

.title {
  flex: 2 1 0;
}

.subsystem {
  flex: 1 1 0;
}

.add-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 20px;
}

.add-link {
  padding: 0;
  border: none;
  background: none;
  color: var(--header-hover-color);
  font: inherit;
  cursor: pointer;
}
</style>
