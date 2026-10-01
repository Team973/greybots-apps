<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import '@material/web/button/filled-button';
import '@material/web/button/text-button';
import AppDialog from '@/components/AppDialog.vue';
import AutosaveStatus from '@/components/AutosaveStatus.vue';
import { useAutosave } from '@/lib/autosave';
import { defaultTeamNumber } from '@/lib/constants';
import { isValidDateRange } from '@/lib/schedule/dates';
import { saveActiveEvent } from '@/lib/schedule/schedule-repo';
import { fetchTeamSchedule } from '@/lib/schedule/tba-import';
import { isValidTeam, normalizeTeam, type ActiveEvent } from '@/lib/schedule/types';
import { useSessionStore } from '@/stores/session-store';
import { useSyncStore } from '@/stores/sync-store';

// Sets up the event (Save button), or edits the existing one (saves
// automatically as each field is committed, i.e. on blur, so a half-typed
// event key never triggers a TBA import).
const props = defineProps<{ open: boolean; current: ActiveEvent | null }>();
const emit = defineEmits<{ close: []; saved: [event: ActiveEvent, eventChanged: boolean] }>();

const session = useSessionStore();
const sync = useSyncStore();

const eventKey = ref('');
const teamNumber = ref('');
const name = ref('');
const startDate = ref('');
const endDate = ref('');
const timezone = ref<string | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);

const isNew = computed(() => !props.current);
const canLookUp = computed(() => sync.online && sync.hasServerSession);
const normalizedKey = () => eventKey.value.trim().toLowerCase();

function validate(): string | null {
  if (!/^\d{4}[a-z0-9]+$/.test(normalizedKey())) return 'Enter a TBA event key, like 2026cc';
  if (!isValidTeam(teamNumber.value)) return 'Enter a team number, like 973 (or 973B for an offseason B team)';
  if (!isValidDateRange(startDate.value, endDate.value)) return 'Enter a first and last day (last on or after first)';
  return null;
}

function value(): ActiveEvent {
  return {
    event_key: normalizedKey(),
    team_number: normalizeTeam(teamNumber.value),
    name: name.value.trim() || normalizedKey(),
    start_date: startDate.value,
    end_date: endDate.value,
    timezone: timezone.value
  };
}

async function persist(next: ActiveEvent) {
  const previous = props.current;
  await saveActiveEvent(next, session.user?.name ?? null);
  const changed = next.event_key !== previous?.event_key || next.team_number !== previous?.team_number;
  emit('saved', next, changed);
}

const autosave = useAutosave(value, persist, {
  enabled: () => props.open && !isNew.value,
  watchSource: false,
  validate: () => validate()
});

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    eventKey.value = props.current?.event_key ?? '';
    teamNumber.value = String(props.current?.team_number ?? defaultTeamNumber);
    name.value = props.current?.name ?? '';
    startDate.value = props.current?.start_date ?? '';
    endDate.value = props.current?.end_date ?? '';
    timezone.value = props.current?.timezone ?? null;
    error.value = null;
    autosave.reset();
  },
  { immediate: true }
);

async function lookUp() {
  error.value = null;
  busy.value = true;
  try {
    const { event } = await fetchTeamSchedule(normalizedKey(), normalizeTeam(teamNumber.value));
    name.value = event.name;
    startDate.value = event.start_date;
    endDate.value = event.end_date;
    timezone.value = event.timezone;
    autosave.trigger();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

async function create() {
  error.value = validate();
  if (error.value) return;
  busy.value = true;
  try {
    await persist(value());
    emit('close');
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

async function close() {
  await autosave.flush();
  emit('close');
}
</script>

<template>
  <AppDialog :open="open" :title="isNew ? 'Set up event' : 'Event settings'" @close="close">
    <div class="form-row">
      <label class="field"><span>TBA event key</span><input v-model="eventKey" placeholder="2026cc" autocapitalize="off" @change="autosave.trigger" /></label>
      <label class="field team"><span>Team</span><input v-model="teamNumber" autocapitalize="characters" placeholder="973" @change="autosave.trigger" /></label>
      <md-text-button class="lookup" :disabled="busy || !canLookUp || !eventKey" @click="lookUp">Look up on TBA</md-text-button>
    </div>
    <label class="field"><span>Event name</span><input v-model="name" @change="autosave.trigger" /></label>
    <div class="form-row">
      <label class="field"><span>First day</span><input v-model="startDate" type="date" @change="autosave.trigger" /></label>
      <label class="field"><span>Last day</span><input v-model="endDate" type="date" @change="autosave.trigger" /></label>
    </div>
    <p v-if="!canLookUp" class="hint">{{ !sync.online ? 'Offline' : 'No server account' }}: enter the details by hand. Matches import from TBA later.</p>
    <p v-if="error" class="error-text">{{ error }}</p>
    <template #actions>
      <AutosaveStatus v-if="!isNew" :state="autosave.state.value" :error="autosave.error.value" />
      <span class="actions-spacer"></span>
      <template v-if="isNew">
        <md-text-button @click="close">Cancel</md-text-button>
        <md-filled-button :disabled="busy" @click="create">Save</md-filled-button>
      </template>
      <md-text-button v-else @click="close">Done</md-text-button>
    </template>
  </AppDialog>
</template>

<style scoped>
.team {
  flex: 0 1 90px;
}

.lookup {
  align-self: flex-end;
  flex: none;
}
</style>
