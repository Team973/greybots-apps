<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import '@material/web/button/filled-button';
import '@material/web/button/outlined-button';
import '@material/web/button/text-button';
import AppDialog from '@/components/AppDialog.vue';
import AutosaveStatus from '@/components/AutosaveStatus.vue';
import { useAutosave } from '@/lib/autosave';
import { formatTime, toLocalInput } from '@/lib/schedule/dates';
import { deleteScheduleItem, saveCustomEvent, saveMatchNotes, validateCustomEvent } from '@/lib/schedule/schedule-repo';
import { categoryLabels, customCategories, type ScheduleCategory, type ScheduleItem } from '@/lib/schedule/types';
import { useSessionStore } from '@/stores/session-store';

// Opened either for an existing item (pass the live copy, so autosave never
// writes back stale fields) or for a new custom event with a pre-selected
// time range (from drag-selecting on the calendar). Edits to an existing item
// save automatically; a new event is created with the Create button.
const props = defineProps<{
  open: boolean;
  eventKey: string;
  item: ScheduleItem | null;
  draft: { start: string; end: string } | null;
  canEdit: boolean;
}>();
const emit = defineEmits<{ close: [] }>();
const session = useSessionStore();

const title = ref('');
const category = ref<ScheduleCategory>('event');
const start = ref('');
const end = ref('');
const notes = ref('');
const error = ref<string | null>(null);
const busy = ref(false);

const isMatch = computed(() => props.item?.kind === 'match');
const isNew = computed(() => !props.item);
const readOnly = computed(() => !props.canEdit);
const dialogTitle = computed(() => (isNew.value ? 'New event' : props.item?.title ?? ''));
const match = computed(() => props.item?.match_info ?? null);
const editor = () => session.user?.name ?? null;

const form = () => ({ title: title.value, category: category.value, start: start.value, end: end.value, notes: notes.value });
const toInput = (f: ReturnType<typeof form>) => ({
  id: props.item?.id,
  title: f.title,
  category: f.category,
  notes: f.notes,
  start_at: f.start,
  end_at: f.end
});

const autosave = useAutosave(
  form,
  (f) =>
    isMatch.value && props.item
      ? // Match times come from TBA; only the notes are editable.
        saveMatchNotes(props.item, f.notes, editor())
      : saveCustomEvent(props.eventKey, toInput(f), editor()),
  {
    enabled: () => props.open && props.canEdit && !!props.item,
    validate: (f) => (isMatch.value ? null : validateCustomEvent(toInput(f)))
  }
);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    const source = props.item;
    title.value = source?.title ?? '';
    category.value = source?.category ?? 'event';
    start.value = toLocalInput(source?.start_at ?? props.draft?.start ?? new Date().toISOString());
    end.value = toLocalInput(source?.end_at ?? props.draft?.end ?? new Date(Date.now() + 3_600_000).toISOString());
    notes.value = source?.notes ?? '';
    error.value = null;
    autosave.reset();
  },
  { immediate: true }
);

async function close() {
  await autosave.flush();
  emit('close');
}

async function run(action: () => Promise<unknown>) {
  error.value = null;
  busy.value = true;
  try {
    await action();
    emit('close');
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

const create = () => run(() => saveCustomEvent(props.eventKey, toInput(form()), editor()));
const remove = () => props.item && run(() => deleteScheduleItem(props.item!.id));
</script>

<template>
  <AppDialog :open="open" :title="dialogTitle" @close="close">
    <template v-if="isMatch && match">
      <p class="match-line">
        <strong>{{ formatTime(item!.start_at) }}</strong>
        <span class="hint-inline">
          published {{ match.scheduled_time ? formatTime(match.scheduled_time) : '—' }}
          <template v-if="match.predicted_time"> · predicted {{ formatTime(match.predicted_time) }}</template>
          <template v-if="match.actual_time"> · started {{ formatTime(match.actual_time) }}</template>
        </span>
      </p>
      <p class="match-line">
        <span class="red" :class="{ ours: match.alliance === 'red' }">Red {{ match.red.join(', ') || '—' }}</span>
        <span class="blue" :class="{ ours: match.alliance === 'blue' }">Blue {{ match.blue.join(', ') || '—' }}</span>
      </p>
    </template>

    <template v-else>
      <div class="form-row">
        <label class="field title-field"><span>Title</span><input v-model="title" :readonly="readOnly" /></label>
        <label class="field">
          <span>Type</span>
          <select v-model="category" :disabled="readOnly">
            <option v-for="c in customCategories" :key="c" :value="c">{{ categoryLabels[c] }}</option>
          </select>
        </label>
      </div>
      <div class="form-row">
        <label class="field"><span>Start</span><input v-model="start" type="datetime-local" step="300" :readonly="readOnly" /></label>
        <label class="field"><span>End</span><input v-model="end" type="datetime-local" step="300" :readonly="readOnly" /></label>
      </div>
    </template>

    <label v-if="canEdit || notes" class="field">
      <span>Notes</span>
      <textarea v-model="notes" rows="2" :readonly="readOnly"></textarea>
    </label>
    <p v-if="error" class="error-text">{{ error }}</p>

    <template #actions>
      <md-outlined-button v-if="canEdit && item && !isMatch" :disabled="busy" @click="remove">Delete</md-outlined-button>
      <AutosaveStatus v-if="canEdit && item" class="status" :state="autosave.state.value" :error="autosave.error.value" />
      <span class="actions-spacer"></span>
      <template v-if="isNew && canEdit">
        <md-text-button @click="close">Cancel</md-text-button>
        <md-filled-button :disabled="busy" @click="create">Create</md-filled-button>
      </template>
      <md-text-button v-else @click="close">Done</md-text-button>
    </template>
  </AppDialog>
</template>

<style scoped>
.title-field {
  flex-grow: 2;
}

.match-line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 12px;
  margin: 0;
}

.hint-inline {
  font-size: 0.85rem;
  opacity: 0.7;
}

.red {
  color: #ef5350;
}

.blue {
  color: #64b5f6;
}

.ours {
  font-weight: 700;
}

.status {
  margin-left: 4px;
}
</style>
