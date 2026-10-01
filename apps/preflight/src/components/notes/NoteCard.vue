<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import AutosaveStatus from '@/components/AutosaveStatus.vue';
import { useAutosave } from '@/lib/autosave';
import { deleteNote, formatNoteTime, updateNote, type Note } from '@/lib/notes/notes';
import { formatTime } from '@/lib/schedule/dates';
import type { ScheduleItem } from '@/lib/schedule/types';
import { useSessionStore } from '@/stores/session-store';

// One note in the list (Notes mockup): a header row that expands to the note
// itself. Edits save automatically while it's open.
const props = defineProps<{
  note: Note;
  expanded: boolean;
  matches: ScheduleItem[];
  subsystems: string[];
  robots: string[];
  canEdit: boolean;
  // Put the cursor in the title when opened (a note that was just created).
  focusTitle?: boolean;
}>();
const emit = defineEmits<{ toggle: [] }>();
const session = useSessionStore();
const editor = () => session.user?.name ?? null;

const title = ref('');
const body = ref('');
const matchKey = ref('');
const robot = ref('');
const subsystem = ref('');
const titleInput = ref<HTMLInputElement | null>(null);

const form = () => ({
  title: title.value,
  body: body.value,
  match_key: matchKey.value || null,
  robot: robot.value || null,
  subsystem: subsystem.value || null
});

const autosave = useAutosave(form, (value) => updateNote(props.note.id, value, editor()), {
  enabled: () => props.expanded && props.canEdit
});

// Load the note when the card opens. While it's open, changes from other
// devices are taken in only when there's no local edit in flight.
function load() {
  title.value = props.note.title;
  body.value = props.note.body;
  matchKey.value = props.note.match_key ?? '';
  robot.value = props.note.robot ?? '';
  subsystem.value = props.note.subsystem ?? '';
  autosave.reset();
}
watch(
  () => props.expanded,
  async (open) => {
    if (open) {
      load();
      if (props.focusTitle) {
        await nextTick();
        titleInput.value?.focus();
      }
    } else {
      await autosave.flush();
    }
  },
  { immediate: true }
);
const stored = () => ({
  title: props.note.title,
  body: props.note.body,
  match_key: props.note.match_key,
  robot: props.note.robot,
  subsystem: props.note.subsystem
});
watch(
  () => props.note.updated_at,
  () => {
    // Our own save coming back matches the form; only reload real changes.
    const changedElsewhere = JSON.stringify(stored()) !== JSON.stringify(form());
    if (props.expanded && changedElsewhere && ['idle', 'saved'].includes(autosave.state.value)) load();
  }
);

const matchTitle = computed(() => props.matches.find((m) => m.match_key === props.note.match_key)?.title ?? props.note.match_key);
const tags = computed(() => [matchTitle.value, props.note.subsystem, props.note.robot].filter((t): t is string => !!t));

async function toggle() {
  await autosave.flush();
  emit('toggle');
}

async function remove() {
  if (!confirm(`Delete "${props.note.title || 'Untitled note'}"?`)) return;
  await deleteNote(props.note.id);
}
</script>

<template>
  <li class="note" :class="{ expanded }">
    <div class="note-head">
      <span v-if="canEdit" class="handle" aria-label="Drag to reorder">⠿</span>
      <button class="head-button" :aria-expanded="expanded" @click="toggle">
        <span class="title" :class="{ untitled: !note.title }">{{ note.title || 'Untitled note' }}</span>
        <span v-for="tag in tags" :key="tag" class="tag">{{ tag }}</span>
        <span class="when">{{ formatNoteTime(note.noted_at) }}</span>
        <span class="chevron" aria-hidden="true">{{ expanded ? '▲' : '▼' }}</span>
      </button>
    </div>

    <div v-if="expanded" class="note-body">
      <label class="field">
        <span>Title</span>
        <input ref="titleInput" v-model="title" :readonly="!canEdit" placeholder="Untitled note" />
      </label>
      <label class="field">
        <span>Note</span>
        <textarea v-model="body" rows="5" :readonly="!canEdit" placeholder="What happened?"></textarea>
      </label>
      <div class="form-row">
        <label class="field">
          <span>Match (optional)</span>
          <select v-model="matchKey" :disabled="!canEdit">
            <option value="">None</option>
            <option v-for="m in matches" :key="m.id" :value="m.match_key ?? ''">{{ m.title }} · {{ formatTime(m.start_at) }}</option>
          </select>
        </label>
        <label class="field">
          <span>Subsystem (optional)</span>
          <input v-model="subsystem" :list="`note-subsystems-${note.id}`" :readonly="!canEdit" />
          <datalist :id="`note-subsystems-${note.id}`">
            <option v-for="s in subsystems" :key="s" :value="s" />
          </datalist>
        </label>
        <label class="field">
          <span>Robot (optional)</span>
          <input v-model="robot" :list="`note-robots-${note.id}`" :readonly="!canEdit" />
          <datalist :id="`note-robots-${note.id}`">
            <option v-for="r in robots" :key="r" :value="r" />
          </datalist>
        </label>
      </div>
      <div class="note-foot">
        <span class="byline">
          {{ note.created_by_name ? `By ${note.created_by_name}` : 'Author unknown' }}
          <template v-if="note.updated_by_name && note.updated_by_name !== note.created_by_name"> · edited by {{ note.updated_by_name }}</template>
        </span>
        <AutosaveStatus v-if="canEdit" :state="autosave.state.value" :error="autosave.error.value" />
        <button v-if="canEdit" class="delete" @click="remove">Delete</button>
      </div>
    </div>
  </li>
</template>

<style scoped>
.note {
  border-radius: 10px;
  border: 1px solid var(--accent-color);
  background: var(--tile-background-color);
}

.note.expanded {
  border-color: var(--header-color);
}

.note-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
}

.handle {
  cursor: grab;
  opacity: 0.6;
  font-size: 1.2rem;
  user-select: none;
  touch-action: none;
}

.head-button {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 12px 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 1.05rem;
}

.title.untitled {
  font-style: italic;
  opacity: 0.6;
}

.tag {
  flex: none;
  max-width: 30%;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--accent-color);
  font-size: 0.75rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.when {
  flex: none;
  font-variant-numeric: tabular-nums;
  opacity: 0.8;
}

.chevron {
  flex: none;
  font-size: 0.8rem;
  opacity: 0.7;
}

.note-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 12px 12px;
}

.note-body textarea {
  min-height: 96px;
}

.note-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.byline {
  flex: 1;
  font-size: 0.8rem;
  opacity: 0.7;
}

.delete {
  padding: 4px 12px;
  border: 1px solid var(--accent-color);
  border-radius: 6px;
  background: transparent;
  color: var(--primary-text-color);
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}

@media (max-width: 600px) {
  .tag {
    display: none;
  }
}
</style>
