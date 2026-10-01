<script setup lang="ts">
import { ref, watch } from 'vue';
import '@material/web/button/filled-button';
import '@material/web/button/text-button';
import AppDialog from '@/components/AppDialog.vue';
import { formatTime } from '@/lib/schedule/dates';
import {
  pendingLabelPresets,
  robotStatusColors,
  robotStatusLabels,
  robotStatuses,
  setRobotStatus,
  statusText,
  type RobotStatus,
  type RobotStatusEntry
} from '@/lib/robot-status/robot-status';
import { useSessionStore } from '@/stores/session-store';

const props = defineProps<{
  open: boolean;
  eventKey: string;
  history: RobotStatusEntry[];
  canEdit: boolean;
}>();
const emit = defineEmits<{ close: [] }>();
const session = useSessionStore();

const status = ref<RobotStatus>('in_pit');
const pendingLabel = ref(pendingLabelPresets[0]);
const note = ref('');
const error = ref<string | null>(null);
const busy = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    const current = props.history[0];
    status.value = current?.status ?? 'in_pit';
    pendingLabel.value = current?.pending_label ?? pendingLabelPresets[0];
    note.value = '';
    error.value = null;
  },
  { immediate: true }
);

async function save() {
  error.value = null;
  busy.value = true;
  try {
    await setRobotStatus(props.eventKey, status.value, pendingLabel.value, note.value, session.user?.name ?? null);
    emit('close');
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppDialog :open="open" :title="canEdit ? 'Robot status' : 'Robot status history'" @close="emit('close')">
    <template v-if="canEdit">
      <div class="status-options" role="radiogroup" aria-label="Robot status">
        <button
          v-for="s in robotStatuses"
          :key="s"
          type="button"
          role="radio"
          :aria-checked="status === s"
          class="status-option"
          :class="{ selected: status === s }"
          :style="{ background: robotStatusColors[s].bg, color: robotStatusColors[s].fg }"
          @click="status = s"
        >
          {{ robotStatusLabels[s] }}
        </button>
      </div>
      <label v-if="status === 'pending'" class="field">
        <span>Pending what?</span>
        <input v-model="pendingLabel" list="pending-presets" />
        <datalist id="pending-presets">
          <option v-for="p in pendingLabelPresets" :key="p" :value="p" />
        </datalist>
      </label>
      <label class="field"><span>Note (optional)</span><input v-model="note" placeholder="e.g. waiting on bumper swap" /></label>
      <p v-if="error" class="error-text">{{ error }}</p>
    </template>

    <h3>History</h3>
    <ul v-if="history.length" class="history">
      <li v-for="entry in history.slice(0, 20)" :key="entry.id">
        <span class="swatch" :style="{ background: robotStatusColors[entry.status].bg }"></span>
        <span class="when">{{ new Date(entry.set_at).toLocaleDateString([], { weekday: 'short' }) }} {{ formatTime(entry.set_at) }}</span>
        <span class="what">
          {{ statusText(entry) }}<template v-if="entry.set_by_name"> · {{ entry.set_by_name }}</template>
          <span v-if="entry.note" class="note">{{ entry.note }}</span>
        </span>
      </li>
    </ul>
    <p v-else class="hint">No status changes yet.</p>

    <template #actions>
      <md-text-button @click="emit('close')">{{ canEdit ? 'Cancel' : 'Close' }}</md-text-button>
      <md-filled-button v-if="canEdit" :disabled="busy" @click="save">Set status</md-filled-button>
    </template>
  </AppDialog>
</template>

<style scoped>
.status-options {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.status-option {
  padding: 14px 8px;
  border: 3px solid transparent;
  border-radius: 10px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  opacity: 0.55;
}

.status-option.selected {
  border-color: var(--primary-text-color);
  opacity: 1;
}

h3 {
  margin: 8px 0 0;
  font-size: 1rem;
}

.history {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 220px;
  overflow-y: auto;
  font-size: 0.9rem;
}

.history li {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.swatch {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: none;
  align-self: center;
}

.when {
  min-width: 88px;
  opacity: 0.7;
}

.what {
  display: flex;
  flex-direction: column;
}

.note {
  opacity: 0.7;
  font-size: 0.85rem;
}
</style>
