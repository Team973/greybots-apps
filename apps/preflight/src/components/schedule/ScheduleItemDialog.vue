<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import '@material/web/button/filled-button';
import '@material/web/button/outlined-button';
import '@material/web/button/text-button';
import AppDialog from '@/components/AppDialog.vue';
import { formatTime, toLocalInput } from '@/lib/schedule/dates';
import { deleteScheduleItem, saveCustomEvent, scheduleTable } from '@/lib/schedule/schedule-repo';
import { saveRecord } from '@/lib/sync/local-repo';
import { categoryLabels, customCategories, type ScheduleCategory, type ScheduleItem } from '@/lib/schedule/types';
import { useSessionStore } from '@/stores/session-store';

// Opened either for an existing item, or for a new custom event with a
// pre-selected time range (from drag-selecting on the calendar).
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
  },
  { immediate: true }
);

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

function save() {
  const editor = session.user?.name ?? null;
  if (isMatch.value && props.item) {
    // Match times come from TBA; only the notes are editable.
    return run(() => saveRecord<ScheduleItem>(scheduleTable, { ...props.item!, notes: notes.value.trim() || null, updated_by_name: editor }));
  }
  return run(() =>
    saveCustomEvent(
      props.eventKey,
      { id: props.item?.id, title: title.value, category: category.value, notes: notes.value, start_at: start.value, end_at: end.value },
      editor
    )
  );
}

function remove() {
  if (!props.item) return;
  return run(() => deleteScheduleItem(props.item!.id));
}
</script>

<template>
  <AppDialog :open="open" :title="dialogTitle" @close="emit('close')">
    <template v-if="isMatch && match">
      <dl class="detail-list">
        <dt>Time</dt>
        <dd>{{ formatTime(item!.start_at) }}</dd>
        <dt>Published</dt>
        <dd>{{ match.scheduled_time ? formatTime(match.scheduled_time) : '—' }}</dd>
        <template v-if="match.predicted_time">
          <dt>Predicted</dt>
          <dd>{{ formatTime(match.predicted_time) }}</dd>
        </template>
        <template v-if="match.actual_time">
          <dt>Actual start</dt>
          <dd>{{ formatTime(match.actual_time) }}</dd>
        </template>
        <dt>Red</dt>
        <dd :class="{ ours: match.alliance === 'red' }">{{ match.red.join(', ') || '—' }}</dd>
        <dt>Blue</dt>
        <dd :class="{ ours: match.alliance === 'blue' }">{{ match.blue.join(', ') || '—' }}</dd>
      </dl>
      <p class="hint">Match times are imported from The Blue Alliance.</p>
    </template>

    <template v-else>
      <label class="field"><span>Title</span><input v-model="title" :readonly="readOnly" /></label>
      <label class="field">
        <span>Type</span>
        <select v-model="category" :disabled="readOnly">
          <option v-for="c in customCategories" :key="c" :value="c">{{ categoryLabels[c] }}</option>
        </select>
      </label>
      <div class="form-row">
        <label class="field"><span>Start</span><input v-model="start" type="datetime-local" step="300" :readonly="readOnly" /></label>
        <label class="field"><span>End</span><input v-model="end" type="datetime-local" step="300" :readonly="readOnly" /></label>
      </div>
    </template>

    <label v-if="canEdit || notes" class="field">
      <span>Notes</span>
      <textarea v-model="notes" :readonly="readOnly"></textarea>
    </label>
    <p v-if="item?.updated_by_name" class="hint">Last edited by {{ item.updated_by_name }}</p>
    <p v-if="error" class="error-text">{{ error }}</p>

    <template #actions>
      <md-outlined-button v-if="canEdit && item && !isMatch" class="delete" :disabled="busy" @click="remove">Delete</md-outlined-button>
      <span class="spacer"></span>
      <md-text-button @click="emit('close')">{{ canEdit ? 'Cancel' : 'Close' }}</md-text-button>
      <md-filled-button v-if="canEdit" :disabled="busy" @click="save">Save</md-filled-button>
    </template>
  </AppDialog>
</template>

<style scoped>
.ours {
  font-weight: 700;
}

.spacer {
  flex: 1;
}
</style>
