<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import '@material/web/button/filled-button';
import '@material/web/button/outlined-button';
import '@material/web/button/text-button';
import AppDialog from '@/components/AppDialog.vue';
import AutosaveStatus from '@/components/AutosaveStatus.vue';
import { useAutosave } from '@/lib/autosave';
import PersonPicker from '@/components/PersonPicker.vue';
import {
  createRepair,
  deleteRepair,
  finishRepair,
  reopenRepair,
  repairStatusLabels,
  startRepairWork,
  updateRepairDetails,
  type Repair,
  type RepairInput,
  type RepairOrigin
} from '@/lib/repairs/repairs';
import { formatTime } from '@/lib/schedule/dates';
import type { ScheduleItem } from '@/lib/schedule/types';
import { robotSuggestions, subsystemSuggestions } from '@/lib/subsystems';
import { useSessionStore } from '@/stores/session-store';

// Log a repair (repair = null) or view/edit an existing one. Pass the live
// copy of the repair: edits to it save automatically. `preset` pre-fills a
// new repair and `origin` records where it was logged from (a task, a
// checklist, or standalone).
const props = defineProps<{
  open: boolean;
  eventKey: string;
  repair: Repair | null;
  matches: ScheduleItem[];
  canEdit: boolean;
  preset?: Partial<RepairInput> | null;
  origin?: RepairOrigin;
}>();
const emit = defineEmits<{ close: []; created: [repair: Repair] }>();
const session = useSessionStore();

const title = ref('');
const details = ref('');
const subsystem = ref('');
const component = ref('');
const robot = ref('');
const assignee = ref('');
const matchKey = ref('');
const error = ref<string | null>(null);
const busy = ref(false);

const isNew = computed(() => !props.repair);
const editor = () => session.user?.name ?? null;
const input = (): RepairInput => ({
  title: title.value,
  details: details.value,
  subsystem: subsystem.value,
  component: component.value,
  robot: robot.value,
  assignee: assignee.value,
  match_key: matchKey.value || null
});

const autosave = useAutosave(input, (value) => updateRepairDetails(props.repair!.id, value, editor()), {
  enabled: () => props.open && props.canEdit && !!props.repair,
  validate: (value) => (value.title.trim() ? null : "Say what's being repaired")
});

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    const source = props.repair ?? props.preset ?? null;
    title.value = source?.title ?? '';
    details.value = source?.details ?? '';
    subsystem.value = source?.subsystem ?? '';
    component.value = source?.component ?? '';
    robot.value = source?.robot ?? '';
    assignee.value = source?.assignee ?? '';
    matchKey.value = source?.match_key ?? '';
    error.value = null;
    autosave.reset();
  },
  { immediate: true }
);

function stamp(at: string, by: string | null) {
  const when = `${new Date(at).toLocaleDateString([], { weekday: 'short' })} ${formatTime(at)}`;
  return by ? `${when} by ${by}` : when;
}

const progress = computed(() => {
  const r = props.repair;
  if (!r) return null;
  const parts = [`Reported ${stamp(r.reported_at, r.reported_by_name)}`];
  if (r.started_at) parts.push(`started ${stamp(r.started_at, r.started_by_name)}`);
  if (r.finished_at) parts.push(`finished ${stamp(r.finished_at, r.finished_by_name)}`);
  return parts.join(' · ');
});

async function close() {
  await autosave.flush();
  emit('close');
}

async function run(action: () => Promise<unknown>, closeAfter = true) {
  error.value = null;
  busy.value = true;
  try {
    // Save any pending edit first, so a status change doesn't race it.
    await autosave.flush();
    await action();
    if (closeAfter) emit('close');
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

const create = (start: boolean) =>
  run(async () => {
    const repair = await createRepair(props.eventKey, input(), editor(), { ...(props.origin ?? { source: 'standalone' }), start });
    emit('created', repair);
  });
</script>

<template>
  <AppDialog :open="open" :title="isNew ? 'Log a repair' : repair?.title || 'Repair'" @close="close">
    <label class="field"><span>What's being repaired</span><input v-model="title" :readonly="!canEdit" placeholder="e.g. Replace bent intake shaft" /></label>
    <div class="form-row">
      <label class="field">
        <span>Subsystem</span>
        <input v-model="subsystem" list="repair-subsystems" :readonly="!canEdit" />
        <datalist id="repair-subsystems"><option v-for="s in subsystemSuggestions" :key="s" :value="s" /></datalist>
      </label>
      <label class="field"><span>Component / part</span><input v-model="component" :readonly="!canEdit" /></label>
      <label class="field">
        <span>Robot</span>
        <input v-model="robot" list="repair-robots" :readonly="!canEdit" />
        <datalist id="repair-robots"><option v-for="r in robotSuggestions" :key="r" :value="r" /></datalist>
      </label>
    </div>
    <div class="form-row">
      <!-- Not a <label>: a click on a dropdown option would re-focus the input. -->
      <div class="field">
        <span>Who's on it</span>
        <PersonPicker v-model="assignee" :disabled="!canEdit" />
      </div>
      <label class="field">
        <span>Match (optional)</span>
        <select v-model="matchKey" :disabled="!canEdit">
          <option value="">None</option>
          <option v-for="m in matches" :key="m.id" :value="m.match_key ?? ''">{{ m.title }} · {{ formatTime(m.start_at) }}</option>
        </select>
      </label>
    </div>
    <label class="field"><span>Details</span><textarea v-model="details" rows="2" :readonly="!canEdit"></textarea></label>
    <p v-if="repair" class="progress">
      <span class="status-pill" :class="repair.status">{{ repairStatusLabels[repair.status] }}</span> {{ progress }}
    </p>
    <p v-if="error" class="error-text">{{ error }}</p>

    <template #actions>
      <template v-if="repair && canEdit">
        <md-outlined-button :disabled="busy" @click="run(() => deleteRepair(repair!.id))">Delete</md-outlined-button>
        <md-outlined-button v-if="repair.status === 'open'" :disabled="busy" @click="run(() => startRepairWork(repair!, editor()), false)">Start</md-outlined-button>
        <md-outlined-button v-if="repair.status !== 'done'" :disabled="busy" @click="run(() => finishRepair(repair!, editor()))">Mark done</md-outlined-button>
        <md-outlined-button v-else :disabled="busy" @click="run(() => reopenRepair(repair!, editor()), false)">Reopen</md-outlined-button>
      </template>
      <span class="actions-spacer"></span>
      <AutosaveStatus v-if="repair && canEdit" :state="autosave.state.value" :error="autosave.error.value" />
      <template v-if="isNew && canEdit">
        <md-text-button @click="close">Cancel</md-text-button>
        <md-outlined-button :disabled="busy" @click="create(false)">Log for later</md-outlined-button>
        <md-filled-button :disabled="busy" @click="create(true)">Start now</md-filled-button>
      </template>
      <md-text-button v-else @click="close">Done</md-text-button>
    </template>
  </AppDialog>
</template>

<style scoped>
.progress {
  margin: 0;
  font-size: 0.85rem;
  opacity: 0.85;
}

.status-pill {
  display: inline-block;
  margin-right: 4px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--accent-color);
  font-size: 0.75rem;
  font-weight: 600;
}

.status-pill.in_progress {
  border-color: #c62828;
  background: #c62828;
  color: #fff;
}

.status-pill.done {
  border-color: #2e7d32;
  background: #2e7d32;
  color: #fff;
}
</style>
