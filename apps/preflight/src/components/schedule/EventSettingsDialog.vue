<script setup lang="ts">
import { ref, watch } from 'vue';
import '@material/web/button/filled-button';
import '@material/web/button/text-button';
import AppDialog from '@/components/AppDialog.vue';
import { defaultTeamNumber } from '@/lib/constants';
import { isValidDateRange } from '@/lib/schedule/dates';
import { saveActiveEvent } from '@/lib/schedule/schedule-repo';
import { fetchTeamSchedule } from '@/lib/schedule/tba-import';
import type { ActiveEvent } from '@/lib/schedule/types';
import { useSessionStore } from '@/stores/session-store';
import { useSyncStore } from '@/stores/sync-store';

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
  },
  { immediate: true }
);

const normalizedKey = () => eventKey.value.trim().toLowerCase();

async function lookUp() {
  error.value = null;
  busy.value = true;
  try {
    const { event } = await fetchTeamSchedule(normalizedKey(), Number(teamNumber.value));
    name.value = event.name;
    startDate.value = event.start_date;
    endDate.value = event.end_date;
    timezone.value = event.timezone;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

async function save() {
  error.value = null;
  const team = Number(teamNumber.value);
  if (!/^\d{4}[a-z0-9]+$/.test(normalizedKey())) return (error.value = 'Enter a TBA event key, like 2026cc');
  if (!Number.isInteger(team) || team <= 0) return (error.value = 'Enter a valid team number');
  if (!isValidDateRange(startDate.value, endDate.value)) return (error.value = 'Enter a start and end date (end on or after start)');

  const value: ActiveEvent = {
    event_key: normalizedKey(),
    team_number: team,
    name: name.value.trim() || normalizedKey(),
    start_date: startDate.value,
    end_date: endDate.value,
    timezone: timezone.value
  };
  busy.value = true;
  try {
    await saveActiveEvent(value, session.user?.name ?? null);
    const changed = value.event_key !== props.current?.event_key || value.team_number !== props.current?.team_number;
    emit('saved', value, changed);
    emit('close');
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppDialog :open="open" title="Event settings" @close="emit('close')">
    <p class="hint">The schedule covers this event's dates. Matches for the team number are imported from The Blue Alliance.</p>
    <div class="form-row">
      <label class="field"><span>TBA event key</span><input v-model="eventKey" placeholder="2026cc" autocapitalize="off" /></label>
      <label class="field"><span>Team number</span><input v-model="teamNumber" inputmode="numeric" /></label>
    </div>
    <div class="form-row">
      <md-text-button :disabled="busy || !sync.online || !sync.hasServerSession || !eventKey" @click="lookUp">
        Look up on TBA
      </md-text-button>
      <span v-if="!sync.online || !sync.hasServerSession" class="hint">
        {{ !sync.online ? 'Offline:' : 'No server account:' }} enter the details by hand.
      </span>
    </div>
    <label class="field"><span>Event name</span><input v-model="name" /></label>
    <div class="form-row">
      <label class="field"><span>First day</span><input v-model="startDate" type="date" /></label>
      <label class="field"><span>Last day</span><input v-model="endDate" type="date" /></label>
    </div>
    <p v-if="error" class="error-text">{{ error }}</p>
    <template #actions>
      <md-text-button @click="emit('close')">Cancel</md-text-button>
      <md-filled-button :disabled="busy" @click="save">Save</md-filled-button>
    </template>
  </AppDialog>
</template>
