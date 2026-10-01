<script setup lang="ts">
import { ref, watch } from 'vue';
import '@material/web/button/filled-button';
import '@material/web/button/text-button';
import AppDialog from '@/components/AppDialog.vue';
import type { ChecklistSequence } from '@/lib/checklists/config';
import { formatTime } from '@/lib/schedule/dates';
import {
  robotStatusColors,
  robotStatusLabels,
  robotStatuses,
  setStatusManually,
  statusText,
  type RobotStatus,
  type RobotStatusEntry
} from '@/lib/robot-status/robot-status';
import { useSessionStore } from '@/stores/session-store';

// Status history for everyone, plus a manual override for leads/admins
// (e.g. to fix a mis-tap). The normal flow uses the Overview's big buttons.
const props = defineProps<{
  open: boolean;
  eventKey: string;
  history: RobotStatusEntry[];
  current: RobotStatus;
  canOverride: boolean;
  sequence: ChecklistSequence;
  nextMatchKey: string | null;
}>();
const emit = defineEmits<{ close: [] }>();
const session = useSessionStore();

const status = ref<RobotStatus>('inbound');
const note = ref('');
const error = ref<string | null>(null);
const busy = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    status.value = props.current;
    note.value = '';
    error.value = null;
  },
  { immediate: true }
);

const optionLabel = (s: RobotStatus) => (s === 'pending' ? 'Restart checklists' : robotStatusLabels[s]);

async function save() {
  error.value = null;
  busy.value = true;
  try {
    await setStatusManually(
      props.eventKey,
      status.value,
      { sequence: props.sequence, matchKey: props.nextMatchKey, note: note.value },
      session.user?.name ?? null
    );
    emit('close');
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppDialog :open="open" :title="canOverride ? 'Robot status' : 'Robot status history'" @close="emit('close')">
    <template v-if="canOverride">
      <div class="status-options" role="radiogroup" aria-label="Set robot status">
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
          {{ optionLabel(s) }}
        </button>
      </div>
      <label class="field"><span>Note (optional)</span><input v-model="note" placeholder="Why the manual change?" /></label>
      <p v-if="error" class="error-text">{{ error }}</p>
    </template>

    <h3>History</h3>
    <ul v-if="history.length" class="history">
      <li v-for="entry in history.slice(0, 30)" :key="entry.id">
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
      <span class="actions-spacer"></span>
      <md-text-button @click="emit('close')">{{ canOverride ? 'Cancel' : 'Close' }}</md-text-button>
      <md-filled-button v-if="canOverride" :disabled="busy" @click="save">Set status</md-filled-button>
    </template>
  </AppDialog>
</template>

<style scoped>
.status-options {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

@media (max-width: 420px) {
  .status-options {
    grid-template-columns: repeat(2, 1fr);
  }
}

.status-option {
  padding: 10px 4px;
  border: 3px solid transparent;
  border-radius: 10px;
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  opacity: 0.55;
}

.status-option.selected {
  border-color: var(--primary-text-color);
  opacity: 1;
}

h3 {
  margin: 4px 0 0;
  font-size: 0.9rem;
}

.history {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 160px;
  overflow-y: auto;
  font-size: 0.85rem;
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
  min-width: 80px;
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
