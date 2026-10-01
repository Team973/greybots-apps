<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import draggable from 'vuedraggable';
import NoteCard from '@/components/notes/NoteCard.vue';
import { useLiveQuery } from '@/lib/live-query';
import { createNote, listNotes, reorderNote, type Note } from '@/lib/notes/notes';
import { getActiveEvent, listScheduleItems } from '@/lib/schedule/schedule-repo';
import type { ActiveEvent, ScheduleItem } from '@/lib/schedule/types';
import { robotSuggestions, subsystemSuggestions, withUsed } from '@/lib/subsystems';
import { useSessionStore } from '@/stores/session-store';

// Notes page (issue #88, Notes mockup): quick, timestamped pit notes for the
// active event. "+" starts a note right away; each one expands to edit and
// can be dragged to reorder. Stored locally and synced like everything else.
const session = useSessionStore();
const canEdit = computed(() => session.hasRole('member'));
const editor = () => session.user?.name ?? null;

const activeEvent = useLiveQuery<ActiveEvent | null>(getActiveEvent, null);
const eventKey = computed(() => activeEvent.value?.event_key ?? '');
const notes = useLiveQuery<Note[]>(() => (eventKey.value ? listNotes(eventKey.value) : []), [], eventKey);
const items = useLiveQuery<ScheduleItem[]>(() => (eventKey.value ? listScheduleItems(eventKey.value) : []), [], eventKey);
const matches = computed(() =>
  items.value.filter((i) => i.kind === 'match').sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
);

const subsystems = computed(() => withUsed(subsystemSuggestions, notes.value.map((n) => n.subsystem)));
const robots = computed(() => withUsed(robotSuggestions, notes.value.map((n) => n.robot)));

// vuedraggable needs a mutable array it can reorder in place.
const ordered = ref<Note[]>([]);
watch(notes, (all) => (ordered.value = [...all]), { immediate: true });

const expandedIds = ref<Set<string>>(new Set());
const justCreatedId = ref<string | null>(null);
function toggle(id: string) {
  const next = new Set(expandedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedIds.value = next;
}

const error = ref<string | null>(null);
async function add() {
  error.value = null;
  try {
    const note = await createNote(eventKey.value, {}, editor());
    justCreatedId.value = note.id;
    expandedIds.value = new Set([...expandedIds.value, note.id]);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

function onDragEnd(event: { oldIndex: number; newIndex: number }) {
  if (event.oldIndex !== event.newIndex) reorderNote(ordered.value, event.newIndex, editor());
}
</script>

<template>
  <div v-if="!activeEvent" class="card">
    <h2>No event set up</h2>
    <p class="hint">Notes are kept per event.</p>
    <RouterLink to="/schedule" class="panel-link">Set up the event on the Schedule page →</RouterLink>
  </div>

  <div v-else class="notes-view">
    <header class="page-header">
      <h1>Notes</h1>
      <button v-if="canEdit" class="icon-button" aria-label="Add note" @click="add">+</button>
    </header>
    <p v-if="error" class="error-text">{{ error }}</p>

    <draggable
      v-model="ordered"
      item-key="id"
      handle=".handle"
      tag="ul"
      class="note-list"
      :disabled="!canEdit"
      :animation="150"
      @end="onDragEnd"
    >
      <template #item="{ element }">
        <NoteCard
          :note="element"
          :expanded="expandedIds.has(element.id)"
          :matches="matches"
          :subsystems="subsystems"
          :robots="robots"
          :can-edit="canEdit"
          :focus-title="element.id === justCreatedId"
          @toggle="toggle(element.id)"
        />
      </template>
    </draggable>
    <p v-if="!ordered.length" class="hint">No notes yet.<template v-if="canEdit"> Tap + to write one.</template></p>
  </div>
</template>

<style scoped>
.notes-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 900px;
}

.page-header {
  display: flex;
  align-items: center;
  gap: 16px;
}

.page-header h1 {
  margin: 0;
  font-size: 1.8rem;
}

.note-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.hint {
  margin: 0;
  opacity: 0.7;
}
</style>
