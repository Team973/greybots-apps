<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import AppDialog from '@greybots/common/components/AppDialog.vue';
import { errorMessage } from '@/lib/db';
import { addDays, combine, parseDate, toDateString, toTimeString, weekdayShort } from '@/lib/dates';
import { createSeries, createSession, deleteFollowing, deleteSession, seriesDates, updateFollowing, updateSession, type Session } from '@/lib/sessions';

// Add a shop session (one-off or repeating), or change or cancel one (leads
// and admins). A session in a repeating series can be changed on its own or
// together with the rest of the series from there on, like a calendar event.
const props = defineProps<{
  open: boolean;
  // The session being changed; none to add one.
  session?: Session | null;
  // Where a new one starts and ends (from dragging across the calendar).
  start?: string | null;
  end?: string | null;
}>();
const emit = defineEmits<{ close: []; saved: [] }>();

const title = ref('');
const date = ref('');
const startTime = ref('18:00');
const endTime = ref('21:00');
const notes = ref('');
const repeat = ref(false);
const weekdays = ref<number[]>([]);
const until = ref('');
// For a session in a series: change just it, or it and the rest.
const scope = ref<'one' | 'following'>('one');
const confirmingDelete = ref(false);
const error = ref('');
const saving = ref(false);

const editing = computed(() => !!props.session);
const inSeries = computed(() => !!props.session?.series_id);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    error.value = '';
    confirmingDelete.value = false;
    scope.value = 'one';
    repeat.value = false;
    const s = props.session;
    if (s) {
      title.value = s.title;
      date.value = toDateString(new Date(s.starts_at));
      startTime.value = toTimeString(s.starts_at);
      endTime.value = toTimeString(s.ends_at);
      notes.value = s.notes;
    } else {
      title.value = 'Shop';
      const start = props.start ? new Date(props.start) : null;
      date.value = start ? toDateString(start) : toDateString(new Date());
      startTime.value = props.start ? toTimeString(props.start) : '18:00';
      endTime.value = props.end ? toTimeString(props.end) : '21:00';
      notes.value = '';
    }
    weekdays.value = [parseDate(date.value).getDay()];
    until.value = addDays(date.value, 7 * 12);
  }
);

// Starting a repeat on a different day keeps the day ticked.
watch(date, (value) => {
  if (!value || editing.value) return;
  const day = parseDate(value).getDay();
  if (!weekdays.value.includes(day)) weekdays.value = [...weekdays.value, day].sort();
});

const repeatCount = computed(() => (repeat.value && date.value && until.value ? seriesDates(weekdays.value, date.value, until.value).length : 0));

function toggleDay(day: number) {
  weekdays.value = weekdays.value.includes(day) ? weekdays.value.filter((d) => d !== day) : [...weekdays.value, day].sort();
}

async function run(action: () => Promise<unknown>) {
  error.value = '';
  saving.value = true;
  try {
    await action();
    emit('saved');
    emit('close');
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

function save() {
  if (!title.value.trim()) {
    error.value = 'Give the session a name.';
    return;
  }
  const fields = { title: title.value.trim(), starts_at: combine(date.value, startTime.value), ends_at: combine(date.value, endTime.value), notes: notes.value.trim() };
  if (props.session) {
    const session = props.session;
    if (inSeries.value && scope.value === 'following') {
      return run(async () => {
        // The rest keep their own dates; only this one moves to a new day.
        await updateFollowing(session, { title: fields.title, start_time: startTime.value, end_time: endTime.value, notes: fields.notes });
        await updateSession(session.id, { starts_at: fields.starts_at, ends_at: fields.ends_at });
      });
    }
    return run(() => updateSession(session.id, fields));
  }
  if (repeat.value) {
    return run(() =>
      createSeries(
        { title: fields.title, weekdays: weekdays.value, start_time: startTime.value, end_time: endTime.value, starts_on: date.value, ends_on: until.value },
        fields.notes
      )
    );
  }
  return run(() => createSession(fields));
}

function remove() {
  const session = props.session;
  if (!session) return;
  return run(() => (inSeries.value && scope.value === 'following' ? deleteFollowing(session) : deleteSession(session.id)));
}
</script>

<template>
  <AppDialog :open="open" :title="editing ? 'Change session' : 'Add a shop session'" @close="emit('close')">
    <form id="session-form" class="form-grid" @submit.prevent="save">
      <label class="field full">
        <span>Name</span>
        <input v-model="title" type="text" maxlength="80" required />
      </label>
      <label class="field">
        <span>{{ repeat ? 'First day' : 'Day' }}</span>
        <input v-model="date" type="date" required />
      </label>
      <label class="field">
        <span>Starts</span>
        <input v-model="startTime" type="time" required />
      </label>
      <label class="field">
        <span>Ends</span>
        <input v-model="endTime" type="time" required />
      </label>
      <label class="field full">
        <span>Notes (shown with the plan)</span>
        <textarea v-model="notes" rows="2" placeholder="e.g. Build day, bring safety glasses"></textarea>
      </label>

      <template v-if="!editing">
        <label class="check full">
          <input v-model="repeat" type="checkbox" />
          Repeats every week
        </label>
        <template v-if="repeat">
          <div class="field full">
            <span>On</span>
            <div class="days">
              <button v-for="(name, day) in weekdayShort" :key="day" type="button" class="day" :class="{ on: weekdays.includes(day) }" @click="toggleDay(day)">
                {{ name }}
              </button>
            </div>
          </div>
          <label class="field">
            <span>Until</span>
            <input v-model="until" type="date" :min="date" required />
          </label>
          <p class="hint full">{{ repeatCount }} {{ repeatCount === 1 ? 'session' : 'sessions' }}. Each one can still be moved or cancelled on its own.</p>
        </template>
      </template>

      <fieldset v-if="inSeries" class="scope full">
        <legend class="muted">This session repeats. Apply changes to:</legend>
        <label class="check"><input v-model="scope" type="radio" value="one" /> Only this session</label>
        <label class="check"><input v-model="scope" type="radio" value="following" /> This and the following sessions (name, times, notes)</label>
      </fieldset>
    </form>

    <p v-if="error" class="error-text">{{ error }}</p>
    <template #actions>
      <template v-if="editing">
        <button v-if="!confirmingDelete" type="button" class="button danger" :disabled="saving" @click="confirmingDelete = true">Cancel session…</button>
        <button v-else type="button" class="button danger" :disabled="saving" @click="remove">
          {{ inSeries && scope === 'following' ? 'Confirm: cancel this and following' : 'Confirm: cancel it' }}
        </button>
      </template>
      <span class="actions-spacer"></span>
      <RouterLink v-if="session" :to="`/sessions/${session.id}`" class="button">Plan</RouterLink>
      <button type="button" class="button" @click="emit('close')">Close</button>
      <button type="submit" form="session-form" class="button primary" :disabled="saving">{{ saving ? 'Saving…' : editing ? 'Save' : 'Add' }}</button>
    </template>
  </AppDialog>
</template>

<style scoped>
.full {
  flex-basis: 100%;
}

.check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.95rem;
}

.days {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.day {
  min-width: 46px;
  padding: 6px 8px;
  border: 1px solid var(--accent-color);
  border-radius: 6px;
  background: transparent;
  color: var(--primary-text-color);
  font: inherit;
  cursor: pointer;
}

.day.on {
  border-color: var(--header-color);
  background: var(--header-color);
  color: var(--header-text-color);
}

.scope {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  border: none;
}

.scope legend {
  margin-bottom: 4px;
  font-size: 0.85rem;
}
</style>
