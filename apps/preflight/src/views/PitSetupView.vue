<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import '@material/web/button/filled-button';
import '@material/web/button/outlined-button';
import AutosaveStatus from '@/components/AutosaveStatus.vue';
import { useAutosave } from '@/lib/autosave';
import {
  defaultPitSetup,
  getChecklistSequence,
  getPitRoles,
  newId,
  newStep,
  saveChecklistSequence,
  savePitRoles,
  stepConditionLabels,
  type StepCondition,
  type ChecklistDef,
  type ChecklistSequence,
  type PitRole
} from '@/lib/checklists/config';
import { useLiveQuery } from '@/lib/live-query';
import { useSessionStore } from '@/stores/session-store';

// Pit setup (issue #82): the pit roles roster and the standard checklist
// sequence that runs each time the robot comes back. Leads/admins edit (saved
// automatically); members can view.
const session = useSessionStore();
const canEdit = computed(() => session.hasRole('lead'));
const editor = () => session.user?.name ?? null;

const remoteRoles = useLiveQuery<PitRole[] | null>(getPitRoles, null);
const remoteSequence = useLiveQuery<ChecklistSequence | null>(getChecklistSequence, null);

// Local working copies the form edits.
const roles = ref<PitRole[]>([]);
const sequence = ref<ChecklistSequence>({ checklists: [] });
const loaded = computed(() => remoteRoles.value !== null && remoteSequence.value !== null);

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const validateNames = (items: { name: string }[], what: string) =>
  items.some((i) => !i.name.trim()) ? `Every ${what} needs a name` : null;

const rolesSave = useAutosave(() => roles.value, (value) => savePitRoles(clone(value), editor()), {
  enabled: () => canEdit.value && loaded.value,
  validate: (value) => validateNames(value, 'role')
});
const sequenceSave = useAutosave(() => sequence.value, (value) => saveChecklistSequence(clone(value), editor()), {
  enabled: () => canEdit.value && loaded.value,
  validate: (value) =>
    validateNames(value.checklists, 'checklist') ??
    (value.checklists.some((c) => c.steps.some((s) => !s.title.trim())) ? 'Every step needs a title' : null)
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

const isEmpty = computed(() => loaded.value && !roles.value.length && !sequence.value.checklists.length);

function loadDefaults() {
  const defaults = defaultPitSetup();
  roles.value = defaults.roles;
  sequence.value = defaults.sequence;
  rolesSave.trigger();
  sequenceSave.trigger();
}

function move<T>(list: T[], index: number, delta: number) {
  const target = index + delta;
  if (target < 0 || target >= list.length) return;
  const [item] = list.splice(index, 1);
  list.splice(target, 0, item);
}

// --- Roles ---
function addRole() {
  roles.value.push({ id: newId(), name: '', assignee: '' });
}

function removeRole(index: number) {
  const [role] = roles.value.splice(index, 1);
  // Drop the role from any steps that used it.
  for (const checklist of sequence.value.checklists) {
    for (const step of checklist.steps) step.role_ids = step.role_ids.filter((id) => id !== role.id);
  }
}

// --- Checklists ---
function addChecklist() {
  sequence.value.checklists.push({ id: newId(), name: '', steps: [newStep()] });
}

function removeChecklist(index: number) {
  const checklist = sequence.value.checklists[index];
  if (checklist.steps.length > 1 && !confirm(`Delete the "${checklist.name || 'untitled'}" checklist and its ${checklist.steps.length} steps?`)) return;
  sequence.value.checklists.splice(index, 1);
}

// Only one checklist can be the pre-match checklist.
function setPrematch(index: number, on: boolean) {
  sequence.value.checklists.forEach((c, i) => (c.prematch = on && i === index));
}

const conditions = Object.entries(stepConditionLabels) as [StepCondition, string][];

function toggleRole(checklist: ChecklistDef, stepIndex: number, roleId: string) {
  const step = checklist.steps[stepIndex];
  step.role_ids = step.role_ids.includes(roleId) ? step.role_ids.filter((id) => id !== roleId) : [...step.role_ids, roleId];
}
</script>

<template>
  <div class="pit-setup">
    <header class="page-header">
      <h1>Pit setup</h1>
      <p class="hint">
        Roles say who does each job. The checklists run in order every time the robot comes back to the pit.
        <template v-if="!canEdit"> Only leads and admins can change them.</template>
      </p>
    </header>

    <p v-if="!loaded" class="hint">Loading…</p>

    <div v-else-if="isEmpty && canEdit" class="card empty">
      <h2>Nothing set up yet</h2>
      <p class="hint">Start from a suggested set of roles and post-match, battery swap, and pre-match checklists, then edit them to fit.</p>
      <div class="form-row">
        <md-filled-button @click="loadDefaults">Load suggested checklists</md-filled-button>
        <md-outlined-button @click="addChecklist">Start from scratch</md-outlined-button>
      </div>
    </div>

    <div v-if="loaded && !(isEmpty && canEdit)" class="columns">
      <!-- Roles roster -->
      <section class="panel roles-panel">
        <header class="panel-header">
          <h2>Pit roles</h2>
          <AutosaveStatus v-if="canEdit" :state="rolesSave.state.value" :error="rolesSave.error.value" />
        </header>
        <ul class="role-list">
          <li v-for="(role, i) in roles" :key="role.id" class="role-row">
            <label class="field"><span>Role</span><input v-model="role.name" :readonly="!canEdit" placeholder="e.g. Battery" /></label>
            <label class="field"><span>Assigned to</span><input v-model="role.assignee" :readonly="!canEdit" placeholder="Name" /></label>
            <button v-if="canEdit" class="icon-small" :aria-label="`Remove ${role.name || 'role'}`" @click="removeRole(i)">✕</button>
          </li>
        </ul>
        <p v-if="!roles.length" class="hint">No roles yet.</p>
        <button v-if="canEdit" class="add-link" @click="addRole">+ Add role</button>
      </section>

      <!-- Checklist sequence -->
      <section class="panel sequence-panel">
        <header class="panel-header">
          <h2>Checklists (in order)</h2>
          <AutosaveStatus v-if="canEdit" :state="sequenceSave.state.value" :error="sequenceSave.error.value" />
        </header>

        <article v-for="(checklist, ci) in sequence.checklists" :key="checklist.id" class="checklist">
          <div class="checklist-head">
            <span class="badge">{{ ci + 1 }}</span>
            <input v-model="checklist.name" class="checklist-name" :readonly="!canEdit" placeholder="Checklist name" aria-label="Checklist name" />
            <template v-if="canEdit">
              <button class="icon-small" :disabled="ci === 0" aria-label="Move checklist up" @click="move(sequence.checklists, ci, -1)">↑</button>
              <button class="icon-small" :disabled="ci === sequence.checklists.length - 1" aria-label="Move checklist down" @click="move(sequence.checklists, ci, 1)">↓</button>
              <button class="icon-small" aria-label="Delete checklist" @click="removeChecklist(ci)">✕</button>
            </template>
          </div>
          <label class="prematch-flag" :title="'After repairs, the pit can jump straight to this checklist'">
            <input type="checkbox" :checked="!!checklist.prematch" :disabled="!canEdit" @change="setPrematch(ci, ($event.target as HTMLInputElement).checked)" />
            Pre-match checklist (repairs can jump here)
          </label>

          <ol class="steps">
            <li v-for="(step, si) in checklist.steps" :key="step.id" class="step">
              <div class="step-head">
                <span class="step-num">{{ si + 1 }}.</span>
                <input v-model="step.title" class="step-title" :readonly="!canEdit" placeholder="Step" aria-label="Step title" />
                <template v-if="canEdit">
                  <button class="icon-small" :disabled="si === 0" aria-label="Move step up" @click="move(checklist.steps, si, -1)">↑</button>
                  <button class="icon-small" :disabled="si === checklist.steps.length - 1" aria-label="Move step down" @click="move(checklist.steps, si, 1)">↓</button>
                  <button class="icon-small" aria-label="Delete step" @click="checklist.steps.splice(si, 1)">✕</button>
                </template>
              </div>
              <textarea v-model="step.instructions" rows="2" :readonly="!canEdit" placeholder="Instructions" aria-label="Instructions"></textarea>
              <label class="condition">
                <span>When</span>
                <select v-model="step.condition" :disabled="!canEdit">
                  <option :value="null">Always</option>
                  <option v-for="[value, label] in conditions" :key="value" :value="value">{{ label }}</option>
                </select>
              </label>
              <div v-if="roles.length" class="role-chips" role="group" aria-label="Roles for this step">
                <button
                  v-for="role in roles"
                  :key="role.id"
                  type="button"
                  class="chip"
                  :class="{ on: step.role_ids.includes(role.id) }"
                  :aria-pressed="step.role_ids.includes(role.id)"
                  :disabled="!canEdit"
                  @click="toggleRole(checklist, si, role.id)"
                >
                  {{ role.name || 'Unnamed role' }}
                </button>
              </div>
            </li>
          </ol>
          <button v-if="canEdit" class="add-link" @click="checklist.steps.push(newStep())">+ Add step</button>
        </article>

        <p v-if="!sequence.checklists.length" class="hint">No checklists yet. When the robot arrives it will go straight to Robot Ready.</p>
        <button v-if="canEdit" class="add-link" @click="addChecklist">+ Add checklist</button>
      </section>
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

@media (max-width: 900px) {
  .columns {
    grid-template-columns: minmax(0, 1fr);
  }
}

.role-list,
.steps {
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

.checklist {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--accent-color);
  background: var(--background-color);
}

.checklist-head,
.step-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: #ffc107;
  color: #1a1a1a;
  font-weight: 700;
}

input.checklist-name,
input.step-title,
.step textarea {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--accent-color);
  background: var(--tile-background-color);
  color: var(--primary-text-color);
  font: inherit;
  box-sizing: border-box;
}

input.checklist-name {
  font-size: 1.05rem;
  font-weight: 600;
}

.step {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-left: 8px;
  border-left: 2px solid var(--accent-color);
}

.step-num {
  min-width: 20px;
  opacity: 0.7;
}

.step textarea {
  width: 100%;
  resize: vertical;
  font-size: 0.9rem;
}

.prematch-flag {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  opacity: 0.85;
}

.condition {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
}

.condition span {
  opacity: 0.7;
}

.condition select {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  border-radius: 6px;
  border: 1px solid var(--accent-color);
  background: var(--tile-background-color);
  color: var(--primary-text-color);
  font: inherit;
}

.role-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.chip {
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid var(--accent-color);
  background: transparent;
  color: var(--primary-text-color);
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
  opacity: 0.7;
}

.chip.on {
  border-color: #2e7d32;
  background: #2e7d32;
  color: #fff;
  opacity: 1;
}

.chip:disabled {
  cursor: default;
}

.icon-small {
  flex: none;
  width: 30px;
  height: 30px;
  border: 1px solid var(--accent-color);
  border-radius: 6px;
  background: transparent;
  color: var(--primary-text-color);
  font: inherit;
  cursor: pointer;
}

.icon-small:disabled {
  opacity: 0.3;
  cursor: default;
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
