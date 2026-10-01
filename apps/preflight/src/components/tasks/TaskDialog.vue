<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import '@material/web/button/filled-button';
import '@material/web/button/outlined-button';
import '@material/web/button/text-button';
import AppDialog from '@/components/AppDialog.vue';
import { formatTime } from '@/lib/schedule/dates';
import type { ScheduleItem } from '@/lib/schedule/types';
import {
  completeTask,
  createTask,
  deleteTask,
  reopenTask,
  startTask,
  taskPresets,
  updateTaskDetails,
  type Task
} from '@/lib/tasks/tasks';
import { useSessionStore } from '@/stores/session-store';

// Create a task (task = null) or view/edit an existing one.
const props = defineProps<{
  open: boolean;
  eventKey: string;
  task: Task | null;
  matches: ScheduleItem[];
  canEdit: boolean;
}>();
const emit = defineEmits<{ close: [] }>();
const session = useSessionStore();

const title = ref('');
const notes = ref('');
const matchKey = ref('');
const error = ref<string | null>(null);
const busy = ref(false);

const isNew = computed(() => !props.task);
const editor = () => session.user?.name ?? null;

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    title.value = props.task?.title ?? '';
    notes.value = props.task?.notes ?? '';
    matchKey.value = props.task?.match_key ?? '';
    error.value = null;
  },
  { immediate: true }
);

function stamp(at: string | null, by: string | null) {
  if (!at) return '—';
  const when = `${new Date(at).toLocaleDateString([], { weekday: 'short' })} ${formatTime(at)}`;
  return by ? `${when} by ${by}` : when;
}

async function run(action: () => Promise<unknown>, close = true) {
  error.value = null;
  busy.value = true;
  try {
    await action();
    if (close) emit('close');
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

const input = () => ({ title: title.value, notes: notes.value, match_key: matchKey.value || null });

function save() {
  return run(() =>
    props.task ? updateTaskDetails(props.task, input(), editor()) : createTask(props.eventKey, input(), editor())
  );
}
</script>

<template>
  <AppDialog :open="open" :title="isNew ? 'New task' : task?.title ?? ''" @close="emit('close')">
    <label class="field"><span>Task</span><input v-model="title" :readonly="!canEdit" placeholder="What needs doing?" /></label>
    <div v-if="isNew" class="presets">
      <button v-for="preset in taskPresets" :key="preset" type="button" class="preset" @click="title = preset">
        {{ preset }}
      </button>
    </div>
    <label class="field">
      <span>Match (optional)</span>
      <select v-model="matchKey" :disabled="!canEdit">
        <option value="">None</option>
        <option v-for="m in matches" :key="m.id" :value="m.match_key ?? ''">{{ m.title }} · {{ formatTime(m.start_at) }}</option>
      </select>
    </label>
    <label class="field"><span>Notes</span><textarea v-model="notes" :readonly="!canEdit"></textarea></label>

    <dl v-if="task" class="detail-list">
      <dt>Started</dt>
      <dd>{{ stamp(task.started_at, task.started_by_name) }}</dd>
      <dt>Completed</dt>
      <dd>{{ stamp(task.completed_at, task.completed_by_name) }}</dd>
    </dl>
    <p v-if="error" class="error-text">{{ error }}</p>

    <template #actions>
      <template v-if="task && canEdit">
        <md-outlined-button :disabled="busy" @click="run(() => deleteTask(task!.id))">Delete</md-outlined-button>
        <md-outlined-button v-if="!task.started_at && !task.completed_at" :disabled="busy" @click="run(() => startTask(task!, editor()), false)">
          Start
        </md-outlined-button>
        <md-outlined-button v-if="!task.completed_at" :disabled="busy" @click="run(() => completeTask(task!, editor()))">Mark done</md-outlined-button>
        <md-outlined-button v-else :disabled="busy" @click="run(() => reopenTask(task!, editor()), false)">Reopen</md-outlined-button>
      </template>
      <span class="spacer"></span>
      <md-text-button @click="emit('close')">{{ canEdit ? 'Cancel' : 'Close' }}</md-text-button>
      <md-filled-button v-if="canEdit" :disabled="busy" @click="save">Save</md-filled-button>
    </template>
  </AppDialog>
</template>

<style scoped>
.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.preset {
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--accent-color);
  background: transparent;
  color: var(--primary-text-color);
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}

.preset:hover {
  border-color: var(--header-color);
}

.spacer {
  flex: 1;
}
</style>
