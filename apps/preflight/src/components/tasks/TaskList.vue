<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import draggable from 'vuedraggable';
import TaskDialog from './TaskDialog.vue';
import { useLiveQuery } from '@/lib/live-query';
import { formatElapsed, useNow } from '@/lib/now';
import type { ScheduleItem } from '@/lib/schedule/types';
import { completeTask, listTasks, reopenTask, reorderTask, type Task } from '@/lib/tasks/tasks';
import { useSessionStore } from '@/stores/session-store';

const props = defineProps<{ eventKey: string; matches: ScheduleItem[] }>();
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
      <h2>Tasks</h2>
      <button v-if="canEdit" class="icon-button" aria-label="Add task" @click="dialog = { taskId: null }">+</button>
    </header>

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
