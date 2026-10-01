<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import '@material/web/button/filled-button';
import '@material/web/button/outlined-button';
import '@material/web/button/text-button';
import AppDialog from '@/components/AppDialog.vue';
import AutosaveStatus from '@/components/AutosaveStatus.vue';
import { useAutosave } from '@/lib/autosave';
import PersonPicker from '@/components/PersonPicker.vue';
import { useLiveQuery } from '@/lib/live-query';
import { createRepair, repairForTask, type Repair } from '@/lib/repairs/repairs';
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

// Create a task (task = null) or view/edit an existing one. Pass the live
// copy of the task: edits to it save automatically.
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
const assignee = ref('');
const error = ref<string | null>(null);
const busy = ref(false);

const isNew = computed(() => !props.task);
const editor = () => session.user?.name ?? null;
const input = () => ({ title: title.value, notes: notes.value, match_key: matchKey.value || null, assignee: assignee.value || null });

const autosave = useAutosave(input, (value) => updateTaskDetails(props.task!, value, editor()), {
  enabled: () => props.open && props.canEdit && !!props.task,
  validate: (value) => (value.title.trim() ? null : 'Task name is required')
});

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    title.value = props.task?.title ?? '';
    notes.value = props.task?.notes ?? '';
    matchKey.value = props.task?.match_key ?? '';
    assignee.value = props.task?.assignee ?? '';
    error.value = null;
    autosave.reset();
  },
  { immediate: true }
);

function stamp(at: string, by: string | null) {
  const when = `${new Date(at).toLocaleDateString([], { weekday: 'short' })} ${formatTime(at)}`;
  return by ? `${when} by ${by}` : when;
}

const progress = computed(() => {
  const t = props.task;
  if (!t) return null;
  const parts: string[] = [];
  if (t.started_at) parts.push(`Started ${stamp(t.started_at, t.started_by_name)}`);
  if (t.completed_at) parts.push(`Done ${stamp(t.completed_at, t.completed_by_name)}`);
  return parts.length ? parts.join(' · ') : 'Not started';
});

// Anyone can claim a task for themselves; saves right away.
const me = computed(() => session.user?.name ?? null);
const isMine = computed(() => !!me.value && assignee.value.trim() === me.value);
async function assignToMe() {
  if (!me.value) return;
  assignee.value = me.value;
  if (props.task) await autosave.flush();
}

// A task that turns out to be a repair can be put in the repair log
// (issue #83), keeping the link back to the task.
const taskId = computed(() => props.task?.id ?? '');
const linkedRepair = useLiveQuery<Repair | null>(() => (taskId.value ? repairForTask(taskId.value) : null), null, taskId);
function logRepair() {
  const task = props.task;
  if (!task) return;
  return run(
    () =>
      createRepair(
        props.eventKey,
        { title: task.title, details: task.notes, assignee: task.assignee, match_key: task.match_key },
        editor(),
        { source: 'task', task_id: task.id, start: !!task.started_at }
      ),
    false
  );
}

async function close() {
  await autosave.flush();
  emit('close');
}

async function run(action: () => Promise<unknown>, closeAfter = true) {
  error.value = null;
  busy.value = true;
  try {
    // Save any pending edit first, so a status change doesn't race it.
    await autosave.flush();
    await action();
    if (closeAfter) emit('close');
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppDialog :open="open" :title="isNew ? 'New task' : task?.title || 'Task'" @close="close">
    <label class="field"><span>Task</span><input v-model="title" :readonly="!canEdit" placeholder="What needs doing?" /></label>
    <div v-if="isNew" class="preset-chips" aria-label="Quick add">
      <button v-for="preset in taskPresets" :key="preset" type="button" class="preset-chip" :class="{ on: title === preset }" @click="title = preset">
        {{ preset }}
      </button>
    </div>
    <div class="form-row">
      <!-- Not a <label>: a click on a dropdown option would re-focus the input. -->
      <div class="field">
        <span>Assigned to</span>
        <span class="assignee-row">
          <PersonPicker v-model="assignee" class="assignee-picker" :disabled="!canEdit" />
          <button v-if="canEdit && me && !isMine" type="button" class="assign-me" @click="assignToMe">Assign to me</button>
        </span>
      </div>
      <label class="field">
        <span>Match (optional)</span>
        <select v-model="matchKey" :disabled="!canEdit">
          <option value="">None</option>
          <option v-for="m in matches" :key="m.id" :value="m.match_key ?? ''">{{ m.title }} · {{ formatTime(m.start_at) }}</option>
        </select>
      </label>
    </div>
    <label class="field"><span>Notes</span><textarea v-model="notes" rows="2" :readonly="!canEdit"></textarea></label>
    <p v-if="progress" class="progress">
      {{ progress }}<template v-if="linkedRepair"> · In the repair log as "{{ linkedRepair.title }}"</template>
    </p>
    <p v-if="error" class="error-text">{{ error }}</p>

    <template #actions>
      <template v-if="task && canEdit">
        <md-outlined-button :disabled="busy" @click="run(() => deleteTask(task!.id))">Delete</md-outlined-button>
        <md-outlined-button v-if="!task.started_at && !task.completed_at" :disabled="busy" @click="run(() => startTask(task!, editor()), false)">
          Start
        </md-outlined-button>
        <md-outlined-button v-if="!task.completed_at" :disabled="busy" @click="run(() => completeTask(task!, editor()))">Mark done</md-outlined-button>
        <md-outlined-button v-else :disabled="busy" @click="run(() => reopenTask(task!, editor()), false)">Reopen</md-outlined-button>
        <md-outlined-button v-if="!linkedRepair" :disabled="busy" @click="logRepair">Log as repair</md-outlined-button>
      </template>
      <span class="actions-spacer"></span>
      <AutosaveStatus v-if="task && canEdit" :state="autosave.state.value" :error="autosave.error.value" />
      <template v-if="isNew && canEdit">
        <md-text-button @click="close">Cancel</md-text-button>
        <md-filled-button :disabled="busy" @click="run(() => createTask(eventKey, input(), editor()))">Create</md-filled-button>
      </template>
      <md-text-button v-else @click="close">Done</md-text-button>
    </template>
  </AppDialog>
</template>

<style scoped>
.assignee-row {
  display: flex;
  gap: 6px;
  opacity: 1;
}

.assignee-picker {
  flex: 1;
  min-width: 0;
}

.assign-me {
  flex: none;
  padding: 0 10px;
  border: 1px solid #2e7d32;
  border-radius: 6px;
  background: transparent;
  color: var(--primary-text-color);
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.progress {
  margin: 0;
  font-size: 0.85rem;
  opacity: 0.75;
}
</style>
