<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import '@material/web/button/filled-button';
import '@material/web/button/outlined-button';
import AutosaveStatus from '@/components/AutosaveStatus.vue';
import ChecklistEditor from '@/components/checklists/ChecklistEditor.vue';
import FlowChecklistEditor from '@/components/checklists/FlowChecklistEditor.vue';
import PersonPicker from '@/components/PersonPicker.vue';
import RepairPresetEditor from '@/components/repairs/RepairPresetEditor.vue';
import DisplayLayoutEditor from '@/components/display/DisplayLayoutEditor.vue';
import { useAutosave } from '@/lib/autosave';
import {
  defaultPitSetup,
  getAdhocChecklists,
  getChecklistSequence,
  getPitRoles,
  matchLinkLabels,
  newId,
  newStep,
  prematchIndex,
  saveAdhocChecklists,
  saveChecklistSequence,
  savePitRoles,
  suggestedRoleNames,
  type ChecklistDef,
  type ChecklistSequence,
  type PitRole
} from '@/lib/checklists/config';
import { useLiveQuery } from '@/lib/live-query';
import { useSessionStore } from '@/stores/session-store';

// Pit setup (issue #82): the pit roles roster, the standard checklist
// sequence that runs each time the robot comes back, and the ad-hoc
// checklists started by hand. Leads/admins edit (saved automatically);
// members can view.
const session = useSessionStore();
const canEdit = computed(() => session.hasRole('lead'));
const editor = () => session.user?.name ?? null;

const remoteRoles = useLiveQuery<PitRole[] | null>(getPitRoles, null);
const remoteSequence = useLiveQuery<ChecklistSequence | null>(getChecklistSequence, null);
const remoteAdhoc = useLiveQuery<ChecklistDef[] | null>(getAdhocChecklists, null);

// Local working copies the form edits.
const roles = ref<PitRole[]>([]);
const sequence = ref<ChecklistSequence>({ checklists: [] });
const adhoc = ref<ChecklistDef[]>([]);
const loaded = computed(() => remoteRoles.value !== null && remoteSequence.value !== null && remoteAdhoc.value !== null);

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const validateNames = (items: { name: string }[], what: string) =>
  items.some((i) => !i.name.trim()) ? `Every ${what} needs a name` : null;
const validateChecklists = (checklists: ChecklistDef[]) =>
  validateNames(checklists, 'checklist') ?? (checklists.some((c) => c.steps.some((s) => !s.title.trim())) ? 'Every step needs a title' : null);

const rolesSave = useAutosave(() => roles.value, (value) => savePitRoles(clone(value), editor()), {
  enabled: () => canEdit.value && loaded.value,
  validate: (value) => validateNames(value, 'role')
});
const sequenceSave = useAutosave(() => sequence.value, (value) => saveChecklistSequence(clone(value), editor()), {
  enabled: () => canEdit.value && loaded.value,
  validate: (value) => validateChecklists(value.checklists)
});
const adhocSave = useAutosave(() => adhoc.value, (value) => saveAdhocChecklists(clone(value), editor()), {
  enabled: () => canEdit.value && loaded.value,
  validate: (value) => validateChecklists(value)
});

// Take in changes saved elsewhere, unless there are local edits in flight.
const busy = (s: string) => s === 'pending' || s === 'saving' || s === 'error';
watch(
  remoteRoles,
  (value) => {
    if (value === null || busy(rolesSave.state.value)) return;
    roles.value = clone(value);
    rolesSave.reset();
  },
  { immediate: true }
);
watch(
  remoteSequence,
  (value) => {
    if (value === null || busy(sequenceSave.state.value)) return;
    sequence.value = clone(value);
    sequenceSave.reset();
  },
  { immediate: true }
);
watch(
  remoteAdhoc,
  (value) => {
    if (value === null || busy(adhocSave.state.value)) return;
    adhoc.value = clone(value);
    adhocSave.reset();
  },
  { immediate: true }
);

const isEmpty = computed(() => loaded.value && !roles.value.length && !sequence.value.checklists.length && !adhoc.value.length);

function loadDefaults() {
  const defaults = defaultPitSetup();
  roles.value = defaults.roles;
  sequence.value = defaults.sequence;
  adhoc.value = defaults.adhoc;
  rolesSave.trigger();
  sequenceSave.trigger();
  adhocSave.trigger();
}

// Adds the suggested ad-hoc checklists to a pit that was set up before they
// existed. Their steps name roles, which are matched to the existing roster.
function loadDefaultAdhoc() {
  const defaults = defaultPitSetup();
  const byName = new Map(roles.value.map((r) => [r.name.trim().toLowerCase(), r.id]));
  const idMap = new Map(defaults.roles.map((r) => [r.id, byName.get(r.name.toLowerCase())]));
  for (const checklist of defaults.adhoc) {
    for (const step of checklist.steps) step.role_ids = step.role_ids.map((id) => idMap.get(id)).filter((id): id is string => !!id);
  }
  adhoc.value = [...adhoc.value, ...defaults.adhoc];
}

function move<T>(list: T[], index: number, delta: number) {
  const target = index + delta;
  if (target < 0 || target >= list.length) return;
  const [item] = list.splice(index, 1);
  list.splice(target, 0, item);
}

// --- Roles ---
function addRole(name = '') {
  roles.value.push({ id: newId(), name, assignee: '' });
}

// Standard roles this pit doesn't have yet (e.g. one added to the app after
// the pit was set up).
const missingRoles = computed(() => {
  const have = new Set(roles.value.map((r) => r.name.trim().toLowerCase()));
  return suggestedRoleNames.filter((name) => !have.has(name.toLowerCase()));
});

function removeRole(index: number) {
  const [role] = roles.value.splice(index, 1);
  // Drop the role from any steps that used it. (The practice field and
  // start / end of day checklists just stop showing a role that's gone.)
  for (const checklist of [...sequence.value.checklists, ...adhoc.value]) {
    for (const step of checklist.steps) step.role_ids = step.role_ids.filter((id) => id !== role.id);
  }
}

// --- Checklists ---
const blankChecklist = (): ChecklistDef => ({ id: newId(), name: '', steps: [newStep()] });

function removeFrom(list: ChecklistDef[], index: number) {
  const checklist = list[index];
  if (checklist.steps.length > 1 && !confirm(`Delete the "${checklist.name || 'untitled'}" checklist and its ${checklist.steps.length} steps?`)) return;
  list.splice(index, 1);
}

// Only one checklist can be the pre-match checklist.
function setPrematch(index: number, on: boolean) {
  sequence.value.checklists.forEach((c, i) => (c.prematch = on && i === index));
}

// What an unset "Belongs to" resolves to, spelled out in the picker.
const sequenceAutoLink = (index: number) =>
  `Automatic: ${matchLinkLabels[index >= prematchIndex(sequence.value) ? 'next' : 'last'].toLowerCase()}`;
</script>

<template>
  <div class="pit-setup">
    <header class="page-header">
      <h1>Pit setup</h1>
      <p class="hint">
        Roles say who does each job. The pit checklists run in order every time the robot comes back to the pit; the others are started
        from the Checklists page when needed.
        <template v-if="!canEdit"> Only leads and admins can change them.</template>
      </p>
    </header>

    <p v-if="!loaded" class="hint">Loading…</p>

    <div v-else-if="isEmpty && canEdit" class="card empty">
      <h2>Nothing set up yet</h2>
      <p class="hint">
        Start from a suggested set of roles, post-match and pre-match checklists, and start-of-day, bumper swap, and deep dive checklists,
        then edit them to fit.
      </p>
      <div class="form-row">
        <md-filled-button @click="loadDefaults">Load suggested checklists</md-filled-button>
        <md-outlined-button @click="sequence.checklists.push(blankChecklist())">Start from scratch</md-outlined-button>
      </div>
    </div>

    <div v-if="loaded && !(isEmpty && canEdit)" class="columns">
      <div class="checklist-column">
      <!-- Roles roster -->
      <section class="panel roles-panel">
        <header class="panel-header">
          <h2>Pit roles</h2>
          <AutosaveStatus v-if="canEdit" :state="rolesSave.state.value" :error="rolesSave.error.value" />
        </header>
        <ul class="role-list">
          <li v-for="(role, i) in roles" :key="role.id" class="role-row">
            <label class="field"><span>Role</span><input v-model="role.name" :readonly="!canEdit" placeholder="e.g. Battery" /></label>
            <div class="field"><span>Assigned to</span><PersonPicker v-model="role.assignee" :disabled="!canEdit" /></div>
            <button v-if="canEdit" class="icon-small" :aria-label="`Remove ${role.name || 'role'}`" @click="removeRole(i)">✕</button>
          </li>
        </ul>
        <p v-if="!roles.length" class="hint">No roles yet.</p>
        <div v-if="canEdit" class="add-row">
          <button class="add-link" @click="addRole()">+ Add role</button>
          <button v-for="name in missingRoles" :key="name" class="add-link" @click="addRole(name)">+ {{ name }}</button>
        </div>
      </section>
      <RepairPresetEditor :can-edit="canEdit" />
      <DisplayLayoutEditor :can-edit="canEdit" />
      </div>

      <div class="checklist-column">
        <!-- Checklist sequence -->
        <section class="panel">
          <header class="panel-header">
            <h2>Pit checklists (in order, every pit visit)</h2>
            <AutosaveStatus v-if="canEdit" :state="sequenceSave.state.value" :error="sequenceSave.error.value" />
          </header>
          <ChecklistEditor
            v-for="(checklist, ci) in sequence.checklists"
            :key="checklist.id"
            :checklist="checklist"
            :index="ci"
            :count="sequence.checklists.length"
            :roles="roles"
            :can-edit="canEdit"
            :auto-link-label="sequenceAutoLink(ci)"
            in-sequence
            @move="(delta) => move(sequence.checklists, ci, delta)"
            @remove="removeFrom(sequence.checklists, ci)"
            @prematch="(on) => setPrematch(ci, on)"
          />
          <p v-if="!sequence.checklists.length" class="hint">No checklists yet. When the robot arrives it will go straight to Robot Ready.</p>
          <button v-if="canEdit" class="add-link" @click="sequence.checklists.push(blankChecklist())">+ Add checklist</button>
        </section>

        <!-- The checklists the flow runs at fixed points -->
        <FlowChecklistEditor
          id="practice"
          heading="Practice field checklist"
          hint="Run from the Overview before taking the robot to the practice field. It's offered once the post-match checklists are done and the robot isn't in repairs; afterwards the pit goes to the pre-match checklist."
          :roles="roles"
          :can-edit="canEdit"
        />
        <FlowChecklistEditor
          id="start_of_day"
          heading="Start of day checklist"
          hint="Run when the day is started (“Start day”, after the day was ended). When it's done, the pit goes to the pre-match checklist."
          :roles="roles"
          :can-edit="canEdit"
        />
        <FlowChecklistEditor
          id="end_of_day"
          heading="End of day checklist"
          hint="Run by “End the day” on the Overview. When it's done the day is ended, and nothing is timed until the day is started again."
          :roles="roles"
          :can-edit="canEdit"
        />

        <!-- Ad-hoc checklists -->
        <section class="panel">
          <header class="panel-header">
            <h2>Other checklists (started when needed)</h2>
            <AutosaveStatus v-if="canEdit" :state="adhocSave.state.value" :error="adhocSave.error.value" />
          </header>
          <ChecklistEditor
            v-for="(checklist, ci) in adhoc"
            :key="checklist.id"
            :checklist="checklist"
            :index="ci"
            :count="adhoc.length"
            :roles="roles"
            :can-edit="canEdit"
            auto-link-label="Automatic: no match"
            @move="(delta) => move(adhoc, ci, delta)"
            @remove="removeFrom(adhoc, ci)"
          />
          <p v-if="!adhoc.length" class="hint">None yet. These are for things like start of day, a bumper swap, or a subsystem deep dive.</p>
          <div v-if="canEdit" class="add-row">
            <button class="add-link" @click="adhoc.push(blankChecklist())">+ Add checklist</button>
            <button v-if="!adhoc.length" class="add-link" @click="loadDefaultAdhoc">+ Add the suggested ones (start of day, bumper swap, deep dive)</button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pit-setup {
  width: 100%;
  max-width: 1200px;
}

.page-header h1 {
  margin: 0;
  font-size: 1.5rem;
}

.page-header .hint {
  margin: 4px 0 12px;
}

.empty {
  max-width: none;
}

.columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: 12px;
  align-items: start;
}

.checklist-column {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

@media (max-width: 900px) {
  .columns {
    grid-template-columns: minmax(0, 1fr);
  }
}

.role-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.role-row {
  display: flex;
  align-items: flex-end;
  gap: 6px;
}

.add-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 20px;
}

.add-link {
  align-self: flex-start;
  padding: 0;
  border: none;
  background: none;
  color: var(--header-hover-color);
  font: inherit;
  cursor: pointer;
}
</style>
