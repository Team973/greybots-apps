<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import '@material/web/button/text-button';
import AppDialog from '@/components/AppDialog.vue';
import AutosaveStatus from '@/components/AutosaveStatus.vue';
import { useAutosave } from '@/lib/autosave';
import { useLiveQuery } from '@/lib/live-query';
import {
  defaultMatchPrep,
  emptyTiming,
  getMatchPrep,
  getMatchTiming,
  saveMatchPrep,
  saveMatchTiming,
  type MatchPrep,
  type MatchTiming
} from '@/lib/schedule/timing';
import { useSessionStore } from '@/stores/session-store';

// Match timing (issue #80): how far the field is running from the published
// schedule, and how long before a match the pit starts prep and leaves for
// the queue. Leads/admins edit (saved automatically, works offline, syncs to
// every device); members can look.
const props = defineProps<{ open: boolean; eventKey: string; canEdit: boolean }>();
const emit = defineEmits<{ close: [] }>();
const session = useSessionStore();
const editor = () => session.user?.name ?? null;

const eventKey = computed(() => props.eventKey);
const timing = useLiveQuery<MatchTiming>(() => getMatchTiming(eventKey.value), emptyTiming(props.eventKey), eventKey);
const prep = useLiveQuery<MatchPrep>(getMatchPrep, defaultMatchPrep);

const delay = ref(0);
const queueMinutes = ref(defaultMatchPrep.queue_minutes);
const prepMinutes = ref(defaultMatchPrep.prep_minutes);

const isWhole = (n: unknown) => typeof n === 'number' && Number.isInteger(n);
const form = () => ({ delay: delay.value, queue: queueMinutes.value, prep: prepMinutes.value });

const autosave = useAutosave(
  form,
  async (f) => {
    // Read the stored timing again so per-match overrides aren't lost.
    const current = await getMatchTiming(props.eventKey);
    if (current.delay_minutes !== f.delay) await saveMatchTiming({ ...current, delay_minutes: f.delay }, editor());
    if (prep.value.queue_minutes !== f.queue || prep.value.prep_minutes !== f.prep) {
      await saveMatchPrep({ queue_minutes: f.queue, prep_minutes: f.prep }, editor());
    }
  },
  {
    enabled: () => props.open && props.canEdit,
    validate: (f) => {
      if (!isWhole(f.delay) || Math.abs(f.delay) > 600) return 'Enter the delay in whole minutes';
      if (!isWhole(f.queue) || f.queue < 0 || !isWhole(f.prep) || f.prep < 0) return 'Enter prep timing in whole minutes';
      return f.prep < f.queue ? 'Prep has to start before the robot leaves for the queue' : null;
    }
  }
);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    delay.value = timing.value.delay_minutes;
    queueMinutes.value = prep.value.queue_minutes;
    prepMinutes.value = prep.value.prep_minutes;
    autosave.reset();
  },
  { immediate: true }
);

const overrideCount = computed(() => Object.keys(timing.value.overrides).length);
const summary = computed(() => {
  if (!isWhole(delay.value) || delay.value === 0) return 'Following The Blue Alliance (predicted, else published, times).';
  const minutes = Math.abs(delay.value);
  return `Upcoming matches are estimated ${minutes} min ${delay.value > 0 ? 'later' : 'earlier'} than published.`;
});

async function clearOverrides() {
  const current = await getMatchTiming(props.eventKey);
  await saveMatchTiming({ ...current, overrides: {} }, editor());
}

async function close() {
  await autosave.flush();
  emit('close');
}
</script>

<template>
  <AppDialog :open="open" title="Match timing" @close="close">
    <label class="field">
      <span>Field is running behind by (minutes; negative = ahead)</span>
      <span class="delay-row">
        <button type="button" class="step" :disabled="!canEdit" aria-label="5 minutes less" @click="delay -= 5">−5</button>
        <input v-model.number="delay" type="number" step="1" :readonly="!canEdit" aria-label="Field delay in minutes" />
        <button type="button" class="step" :disabled="!canEdit" aria-label="5 minutes more" @click="delay += 5">+5</button>
        <button type="button" class="step" :disabled="!canEdit || delay === 0" @click="delay = 0">On time</button>
      </span>
    </label>
    <p class="hint">{{ summary }} Use this when official timing is missing or wrong; it works offline.</p>
    <p v-if="overrideCount" class="hint">
      {{ overrideCount }} match{{ overrideCount === 1 ? ' has its' : 'es have their' }} own estimate (set from the match on the calendar).
      <button v-if="canEdit" type="button" class="link" @click="clearOverrides">Clear</button>
    </p>

    <div class="form-row">
      <label class="field">
        <span>Start prep (min before match)</span>
        <input v-model.number="prepMinutes" type="number" min="0" step="5" :readonly="!canEdit" />
      </label>
      <label class="field">
        <span>Leave for queue (min before match)</span>
        <input v-model.number="queueMinutes" type="number" min="0" step="5" :readonly="!canEdit" />
      </label>
    </div>

    <template #actions>
      <AutosaveStatus v-if="canEdit" :state="autosave.state.value" :error="autosave.error.value" />
      <span class="actions-spacer"></span>
      <md-text-button @click="close">Done</md-text-button>
    </template>
  </AppDialog>
</template>

<style scoped>
.delay-row {
  display: flex;
  gap: 6px;
  opacity: 1;
}

.delay-row input {
  flex: 1;
  min-width: 0;
  text-align: center;
  font-size: 1.1rem;
  font-weight: 700;
}

.step {
  flex: none;
  padding: 0 12px;
  border: 1px solid var(--accent-color);
  border-radius: 6px;
  background: transparent;
  color: var(--primary-text-color);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.step:disabled {
  opacity: 0.4;
  cursor: default;
}

.hint {
  margin: 0;
  opacity: 0.7;
  font-size: 0.85rem;
}

.link {
  padding: 0;
  border: none;
  background: none;
  color: var(--header-hover-color);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}
</style>
