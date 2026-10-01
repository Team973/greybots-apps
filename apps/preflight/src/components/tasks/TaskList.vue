<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import draggable from 'vuedraggable';
import TaskDialog from './TaskDialog.vue';
import { useLiveQuery } from '@/lib/live-query';
import { formatElapsed, useNow } from '@greybots/common/lib/now';
import type { ScheduleItem } from '@/lib/schedule/types';
import { usePitMembers } from '@/lib/checklists/pit-members';
import { completeTask, createTask, listTasks, reopenTask, reorderTask, type Task } from '@/lib/tasks/tasks';
import { useSessionStore } from '@/stores/session-store';

// `quickAdd` shows an inline "add and assign" row (used during repairs, where
// speed matters more than presets and notes).
const props = withDefaults(defineProps<{ eventKey: string; matches: ScheduleItem[]; heading?: string; quickAdd?: boolean }>(), {
  heading: 'Tasks',
  quickAdd: false
});
const session = useSessionStore();
const canEdit = computed(() => session.hasRole('member'));
const editor = () => session.user?.name ?? null;
const now = useNow(30_000);

const eventKey = computed(() => props.eventKey);
const tasks = useLiveQuery<Task[]>(() => listTasks(eventKey.value), [], eventKey);

// vuedraggable needs a mutable array it can reorder in place.
const active = ref<Task[]>([]);
watch(tasks, (all) => (active.value = all.filter((t) => !t.completed_at)), { immediate: true });
const done = computed(() =>
  tasks.value.filter((t) => t.completed_at).sort((a, b) => Date.parse(b.completed_at!) - Date.parse(a.completed_at!))
);
const showDone = ref(false);

const matchTitles = computed(() => new Map(props.matches.map((m) => [m.match_key, m.title])));

function meta(task: Task): string {
  const parts: string[] = [];
  if (task.started_at && !task.completed_at) parts.push(`In progress · ${formatElapsed(now.value - Date.parse(task.started_at))}`);
  if (task.completed_by_name) parts.push(`Done by ${task.completed_by_name}`);
  if (task.match_key) parts.push(matchTitles.value.get(task.match_key) ?? task.match_key);
  return parts.join(' · ');
}

// --- Inline quick add ---
const members = usePitMembers();
const quickTitle = ref('');
const quickAssignee = ref('');
const quickError = ref<string | null>(null);
watch(quickTitle, () => (quickError.value = null));
async function addQuick() {
  quickError.value = null;
  if (!quickTitle.value.trim()) return (quickError.value = 'What needs doing?');
  try {
    await createTask(props.eventKey, { title: quickTitle.value, notes: null, match_key: null, assignee: quickAssignee.value || null }, editor());
    quickTitle.value = '';
  } catch (e) {
    quickError.value = e instanceof Error ? e.message : String(e);
  }
}

function toggle(task: Task) {
  return task.completed_at ? reopenTask(task, editor()) : completeTask(task, editor());
}

function onDragEnd(event: { oldIndex: number; newIndex: number }) {
  if (event.oldIndex !== event.newIndex) reorderTask(active.value, event.newIndex, editor());
}

// The dialog shows the live copy of the task, so Start/Reopen update in place.
const dialog = ref<{ taskId: string | null } | null>(null);
const dialogTask = computed(() => (dialog.value?.taskId ? tasks.value.find((t) => t.id === dialog.value!.taskId) ?? null : null));
</script>

<template>
  <section class="panel tasks">
    <header class="panel-header">
      <h2>{{ heading }}</h2>
      <button v-if="canEdit" class="icon-button" aria-label="Add task" @click="dialog = { taskId: null }">+</button>
    </header>

    <form v-if="quickAdd && canEdit" class="quick-add" @submit.prevent="addQuick">
      <input v-model="quickTitle" class="quick-title" placeholder="What needs fixing?" aria-label="New task" />
      <input v-model="quickAssignee" class="quick-assignee" list="quick-assignees" placeholder="Assign to" aria-label="Assign to" />
      <datalist id="quick-assignees">
        <option v-for="name in members" :key="name" :value="name" />
      </datalist>
      <button type="submit" class="quick-submit">Add</button>
    </form>
    <p v-if="quickError" class="error-text">{{ quickError }}</p>

    <draggable
      v-model="active"
      item-key="id"
      handle=".handle"
      tag="ul"
      class="task-list"
      :disabled="!canEdit"
      :animation="150"
      @end="onDragEnd"
    >
      <template #item="{ element }">
        <li class="task" :class="{ started: element.started_at }">
          <span v-if="canEdit" class="handle" aria-label="Drag to reorder">⠿</span>
          <button class="task-body" @click="dialog = { taskId: element.id }">
            <span class="title">{{ element.title }}</span>
            <span v-if="meta(element)" class="meta">{{ meta(element) }}</span>
          </button>
          <span class="assignee-pill" :class="{ unassigned: !element.assignee }">{{ element.assignee || 'Unassigned' }}</span>
          <input type="checkbox" class="check" :checked="false" :disabled="!canEdit" :aria-label="`Complete ${element.title}`" @change="toggle(element)" />
        </li>
      </template>
    </draggable>
    <p v-if="!active.length" class="hint">No open tasks.</p>

    <button v-if="done.length" class="done-toggle" @click="showDone = !showDone">
      {{ showDone ? 'Hide' : 'Show' }} completed ({{ done.length }})
    </button>
    <ul v-if="showDone" class="task-list">
      <li v-for="task in done" :key="task.id" class="task done">
        <button class="task-body" @click="dialog = { taskId: task.id }">
          <span class="title">{{ task.title }}</span>
          <span class="meta">{{ meta(task) }}</span>
        </button>
        <span class="assignee-pill" :class="{ unassigned: !task.assignee }">{{ task.assignee || 'Unassigned' }}</span>
        <input type="checkbox" class="check" checked :disabled="!canEdit" :aria-label="`Reopen ${task.title}`" @change="toggle(task)" />
      </li>
    </ul>

    <TaskDialog
      :open="!!dialog"
      :event-key="eventKey"
      :task="dialogTask"
      :matches="matches"
      :can-edit="canEdit"
      @close="dialog = null"
    />
  </section>
</template>

<style scoped>
.quick-add {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.quick-add input {
  min-width: 0;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid var(--accent-color);
  background: var(--background-color);
  color: var(--primary-text-color);
  font: inherit;
}

.quick-title {
  flex: 2 1 200px;
}

.quick-assignee {
  flex: 1 1 120px;
}

.quick-submit {
  padding: 10px 18px;
  border: none;
  border-radius: 8px;
  background: #2e7d32;
  color: #fff;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.assignee-pill {
  flex: none;
  max-width: 40%;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--accent-color);
  font-size: 0.85rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assignee-pill.unassigned {
  background: transparent;
  border: 1px dashed var(--accent-color);
  font-weight: 400;
  font-style: italic;
  opacity: 0.7;
}

.task-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.task {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid var(--accent-color);
  background: var(--background-color);
}

.task.started {
  border-color: #e0a43a;
}

.task.done .title {
  text-decoration: line-through;
  opacity: 0.6;
}

.handle {
  cursor: grab;
  opacity: 0.6;
  font-size: 1.2rem;
  user-select: none;
  touch-action: none;
}

.task-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 0;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.title {
  overflow-wrap: anywhere;
}

.meta {
  font-size: 0.8rem;
  opacity: 0.7;
}

.check {
  width: 24px;
  height: 24px;
  flex: none;
  accent-color: #2e7d32;
  cursor: pointer;
}

.done-toggle {
  align-self: flex-start;
  margin-top: 8px;
  padding: 0;
  border: none;
  background: none;
  color: var(--primary-text-color);
  opacity: 0.7;
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}
</style>
