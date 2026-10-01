<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import '@material/web/button/filled-button';
import '@material/web/button/outlined-button';
import '@material/web/button/text-button';
import AppDialog from '@/components/AppDialog.vue';
import AutosaveStatus from '@/components/AutosaveStatus.vue';
import { clockNow } from '@greybots/common/lib/now';
import { useAutosave } from '@/lib/autosave';
import { formatTime, toLocalInput } from '@/lib/schedule/dates';
import { deleteScheduleItem, saveCustomEvent, saveMatchNotes, validateCustomEvent } from '@/lib/schedule/schedule-repo';
import { estimateSourceLabels, setMatchOverride } from '@/lib/schedule/timing';
import {
  categoryLabels,
  customCategories,
  milestonePhases,
  phaseLabels,
  scheduleCategories,
  type MilestonePhase,
  type ScheduleCategory,
  type ScheduleItem
} from '@/lib/schedule/types';
import { useSessionStore } from '@/stores/session-store';

// Opened either for an existing item (pass the live copy, so autosave never
// writes back stale fields) or for a new custom event or milestone (`kind`)
// with a pre-selected time range (e.g. from drag-selecting on the calendar).
// Edits to an existing item save automatically; a new one is created with
// the Create button.
const props = defineProps<{
  open: boolean;
  eventKey: string;
  item: ScheduleItem | null;
  draft: { start: string; end: string } | null;
  canEdit: boolean;
  // What a new item is; an existing item keeps its own kind.
  kind?: 'custom' | 'milestone';
}>();
const emit = defineEmits<{ close: [] }>();
const session = useSessionStore();

const title = ref('');
const category = ref<ScheduleCategory>('event');
const phase = ref<MilestonePhase | ''>('');
const start = ref('');
const end = ref('');
const notes = ref('');
const error = ref<string | null>(null);
const busy = ref(false);

const isMatch = computed(() => props.item?.kind === 'match');
const isNew = computed(() => !props.item);
const isMilestone = computed(() => (props.item ? props.item.kind === 'milestone' : props.kind === 'milestone'));
// Milestones can also be about matches (e.g. "Qualification matches").
const categoryOptions = computed(() => (isMilestone.value ? scheduleCategories : customCategories));
const readOnly = computed(() => !props.canEdit);
const dialogTitle = computed(() => (isNew.value ? (isMilestone.value ? 'New milestone' : 'New event') : props.item?.title ?? ''));
const match = computed(() => props.item?.match_info ?? null);
const times = computed(() => props.item?.times ?? null);
// Leads/admins can set a match's estimated start by hand until it's played.
const canOverride = computed(() => props.canEdit && !!times.value && !times.value.actualStart && !!props.item?.match_key);
const override = ref('');
const editor = () => session.user?.name ?? null;

const form = () => ({
  title: title.value,
  category: category.value,
  phase: phase.value,
  start: start.value,
  end: end.value,
  notes: notes.value
});
const toInput = (f: ReturnType<typeof form>) => ({
  id: props.item?.id,
  title: f.title,
  category: f.category,
  notes: f.notes,
  start_at: f.start,
  end_at: f.end,
  kind: isMilestone.value ? ('milestone' as const) : ('custom' as const),
  phase: f.phase || null
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
    phase.value = source?.phase ?? '';
    start.value = toLocalInput(source?.start_at ?? props.draft?.start ?? new Date(clockNow()).toISOString());
    end.value = toLocalInput(source?.end_at ?? props.draft?.end ?? new Date(clockNow() + 3_600_000).toISOString());
    notes.value = source?.notes ?? '';
    override.value = source?.times?.source === 'override' ? toLocalInput(source.times.estimated) : '';
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

// Saved when the field is committed, not on every keystroke.
async function saveOverride(value: string | null) {
  if (!props.item?.match_key) return;
  error.value = null;
  try {
    if (value !== null && Number.isNaN(Date.parse(value))) throw new Error('Enter a valid time');
    await setMatchOverride(props.eventKey, props.item.match_key, value, editor());
    if (value === null) override.value = '';
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

const create = () => run(() => saveCustomEvent(props.eventKey, toInput(form()), editor()));
const remove = () => props.item && run(() => deleteScheduleItem(props.item!.id));
</script>

<template>
  <AppDialog :open="open" :title="dialogTitle" @close="close">
    <template v-if="isMatch && match">
      <dl v-if="times" class="times">
        <div><dt>Published</dt><dd>{{ times.published ? formatTime(times.published) : '—' }}</dd></div>
        <div :class="{ primary: !times.actualStart }">
          <dt>Estimated</dt>
          <dd>{{ formatTime(times.estimated) }}</dd>
          <dd class="source">{{ estimateSourceLabels[times.source] }}</dd>
        </div>
        <div :class="{ primary: !!times.actualStart }"><dt>Started</dt><dd>{{ times.actualStart ? formatTime(times.actualStart) : '—' }}</dd></div>
        <div><dt>Completed</dt><dd>{{ times.completed ? formatTime(times.completed) : '—' }}</dd></div>
      </dl>
      <label v-if="canOverride" class="field">
        <span>Set the estimated start by hand (overrides TBA and the field delay)</span>
        <span class="override-row">
          <input v-model="override" type="datetime-local" step="60" @change="saveOverride(override || null)" />
          <button v-if="times?.source === 'override'" type="button" class="clear" @click="saveOverride(null)">Clear</button>
        </span>
      </label>
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
            <option v-for="c in categoryOptions" :key="c" :value="c">{{ categoryLabels[c] }}</option>
          </select>
        </label>
        <label v-if="isMilestone" class="field">
          <span>Phase</span>
          <select v-model="phase" :disabled="readOnly">
            <option value="">None</option>
            <option v-for="p in milestonePhases" :key="p" :value="p">{{ phaseLabels[p] }}</option>
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

.times {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  margin: 0;
}

.times div {
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--background-color);
}

.times div.primary {
  box-shadow: 0 0 0 1px #ff8a1f;
}

.times dt {
  font-size: 0.7rem;
  opacity: 0.7;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.times dd {
  margin: 0;
  font-weight: 700;
}

.times dd.source {
  font-size: 0.7rem;
  font-weight: 400;
  opacity: 0.7;
}

.override-row {
  display: flex;
  gap: 6px;
  opacity: 1;
}

.override-row input {
  flex: 1;
  min-width: 0;
}

.clear {
  flex: none;
  padding: 0 12px;
  border: 1px solid var(--accent-color);
  border-radius: 6px;
  background: transparent;
  color: var(--primary-text-color);
  font: inherit;
  cursor: pointer;
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
