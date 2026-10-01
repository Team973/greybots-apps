<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import '@material/web/button/filled-button';
import '@material/web/button/text-button';
import { formatClock } from '@greybots/common/lib/now';
import AppDialog from '@/components/AppDialog.vue';
import { checkStep, listChecks, uncheckStep, type ChecklistCheck } from '@/lib/checklists/checks';
import type { ChecklistSequence, PitRole } from '@/lib/checklists/config';
import { activeStepIndex, evaluateStep, stepState, type StepContext } from '@/lib/checklists/smart';
import { useLiveQuery } from '@/lib/live-query';
import { formatTime } from '@/lib/schedule/dates';
import type { ScheduleItem } from '@/lib/schedule/types';
import { advanceChecklist, startRepair, type RobotStatusEntry } from '@/lib/robot-status/robot-status';
import { useSessionStore } from '@/stores/session-store';

// The Pending state: the active checklist (steps done strictly in order) and,
// in its own panel, the active step's instructions and who holds each role.
// Smart steps that don't apply (e.g. no bumper swap needed) show as skipped.
// Finishing the last step loads the next checklist, or Robot Ready after the
// last one. "Repairs" switches to Repair in progress from any checklist.
// Renders two panels (.area-checklist and .area-step) for the Overview grid.
const props = defineProps<{
  eventKey: string;
  entry: RobotStatusEntry;
  sequence: ChecklistSequence;
  roles: PitRole[];
  matches: ScheduleItem[];
  now: number;
  elapsedMs: number | null;
}>();
const session = useSessionStore();
const canAct = computed(() => session.hasRole('member'));
const canEditSetup = computed(() => session.hasRole('lead'));
const editor = () => session.user?.name ?? null;

const runId = computed(() => props.entry.run_id ?? '');
const checks = useLiveQuery<ChecklistCheck[]>(() => listChecks(props.eventKey, runId.value), [], runId);
const ctx = computed<StepContext>(() => ({ matches: props.matches, now: props.now }));

const index = computed(() => props.entry.checklist_index ?? 0);
const checklist = computed(() => props.sequence.checklists[index.value] ?? null);
const states = computed(() => (checklist.value ? checklist.value.steps.map((s) => stepState(checks.value, checklist.value!, s, ctx.value)) : []));
const nextIndex = computed(() => (checklist.value ? activeStepIndex(checks.value, checklist.value, ctx.value) : 0));
const activeStep = computed(() => checklist.value?.steps[nextIndex.value] ?? null);
const activeNote = computed(() => (activeStep.value ? evaluateStep(activeStep.value, ctx.value).note : null));
const total = computed(() => props.sequence.checklists.length);
const isComplete = computed(() => !!checklist.value && checklist.value.steps.length > 0 && nextIndex.value >= checklist.value.steps.length);
// The last step that was actually done (not skipped), for Undo.
const undoIndex = computed(() => {
  for (let i = nextIndex.value - 1; i >= 0; i--) if (states.value[i] === 'done') return i;
  return -1;
});

// What happens after the active step: counts only steps still to do.
const doneLabel = computed(() => {
  const remaining = states.value.slice(nextIndex.value + 1).filter((st) => st === 'todo').length;
  if (remaining > 0) return 'Done · next step';
  return index.value + 1 < total.value ? 'Done · next checklist' : 'Done · robot ready';
});

const rolesById = computed(() => new Map(props.roles.map((r) => [r.id, r])));
const activeRoles = computed(() =>
  (activeStep.value?.role_ids ?? []).map((id) => rolesById.value.get(id)).filter((r): r is PitRole => !!r)
);

function checkFor(stepId: string) {
  return checks.value.find((c) => c.checklist_id === checklist.value?.id && c.step_id === stepId && c.completed_at) ?? null;
}

const busy = ref(false);
const error = ref<string | null>(null);

async function act(action: () => Promise<unknown>) {
  error.value = null;
  busy.value = true;
  try {
    await action();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

// Complete the active step; once nothing is left to do, move on.
function completeActive() {
  const list = checklist.value;
  const step = activeStep.value;
  if (!list || !step) return;
  return act(async () => {
    await checkStep(props.eventKey, runId.value, list, step, editor());
    const fresh = await listChecks(props.eventKey, runId.value);
    if (activeStepIndex(fresh, list, ctx.value) >= list.steps.length) {
      await advanceChecklist(props.eventKey, props.entry, props.sequence, editor());
    }
  });
}

function undoLast() {
  const list = checklist.value;
  const step = list?.steps[undoIndex.value];
  if (!list || !step) return;
  return act(() => uncheckStep(runId.value, list, step, editor()));
}

// Moves on when nothing is left to click: an empty checklist, one removed
// from the sequence mid-run, or one whose remaining steps were all skipped.
const continueOn = () => act(() => advanceChecklist(props.eventKey, props.entry, props.sequence, editor()));

// --- Repairs ---
const repairOpen = ref(false);
const repairNote = ref('');
function openRepair() {
  repairNote.value = '';
  repairOpen.value = true;
}
const confirmRepair = () =>
  act(async () => {
    await startRepair(props.eventKey, props.entry, editor(), repairNote.value);
    repairOpen.value = false;
  });
</script>

<template>
  <section class="panel area-checklist">
    <ol class="progress" aria-label="Checklist sequence">
      <li v-for="(c, i) in sequence.checklists" :key="c.id" :class="{ done: i < index, current: i === index }">{{ c.name }}</li>
    </ol>
    <header class="checklist-header">
      <div>
        <p v-if="checklist" class="eyebrow">Checklist {{ index + 1 }} of {{ total }}</p>
        <h2>{{ checklist?.name ?? entry.pending_label ?? 'Checklist' }}</h2>
      </div>
      <div class="elapsed" title="Time in this checklist">
        <span class="elapsed-value">{{ elapsedMs === null ? '--:--' : formatClock(elapsedMs) }}</span>
        <span class="elapsed-label">in this checklist</span>
      </div>
    </header>

    <template v-if="checklist && checklist.steps.length">
      <ol class="steps">
        <li
          v-for="(step, i) in checklist.steps"
          :key="step.id"
          class="step"
          :class="[states[i], { active: i === nextIndex, upcoming: i > nextIndex && states[i] === 'todo' }]"
        >
          <span class="marker" aria-hidden="true">{{ states[i] === 'done' ? '✓' : states[i] === 'skipped' ? '–' : i + 1 }}</span>
          <span class="step-text">
            <span class="step-title">{{ step.title }}<span v-if="step.condition" class="smart-badge">Smart</span></span>
            <span v-if="states[i] === 'done' && checkFor(step.id)" class="step-meta">
              {{ formatTime(checkFor(step.id)!.completed_at!) }}<template v-if="checkFor(step.id)!.completed_by_name"> · {{ checkFor(step.id)!.completed_by_name }}</template>
            </span>
            <span v-else-if="states[i] === 'skipped'" class="step-meta">Skipped · {{ evaluateStep(step, ctx).note }}</span>
          </span>
          <button v-if="canAct && i === undoIndex" class="undo" :disabled="busy" @click="undoLast">Undo</button>
        </li>
      </ol>
    </template>
    <div v-if="!checklist || !checklist.steps.length || isComplete" class="empty">
      <p class="hint">
        {{ !checklist ? "This checklist isn't in the sequence anymore." : !checklist.steps.length ? 'This checklist has no steps.' : 'Everything here is done.' }}
      </p>
      <button v-if="canAct" class="primary-action small" :disabled="busy" @click="continueOn">Continue</button>
    </div>
    <div v-if="canAct" class="repair-row">
      <button class="repair-button" :disabled="busy" @click="openRepair">Repairs</button>
    </div>
    <p v-if="error" class="error-text">{{ error }}</p>
  </section>

  <section class="panel area-step">
    <template v-if="activeStep">
      <p class="eyebrow">Step {{ nextIndex + 1 }} of {{ checklist!.steps.length }}</p>
      <h2 class="active-title">{{ activeStep.title }}</h2>
      <p v-if="activeNote" class="smart-note">{{ activeNote }}</p>
      <p v-if="activeStep.instructions" class="instructions">{{ activeStep.instructions }}</p>
      <div v-if="activeRoles.length" class="roles">
        <h3>Who</h3>
        <ul>
          <li v-for="role in activeRoles" :key="role.id">
            <span class="role-name">{{ role.name }}</span>
            <span class="assignee" :class="{ unassigned: !role.assignee }">{{ role.assignee || 'Unassigned' }}</span>
          </li>
        </ul>
      </div>
      <span class="grow"></span>
      <button v-if="canAct" class="primary-action" :disabled="busy" @click="completeActive">{{ doneLabel }}</button>
    </template>
    <p v-else class="hint">Nothing left in this checklist.</p>
    <RouterLink v-if="canEditSetup" to="/pit-setup" class="panel-link setup-link">Edit checklists and roles</RouterLink>
  </section>

  <AppDialog :open="repairOpen" title="Start repairs" @close="repairOpen = false">
    <p class="hint">The robot goes to Repair in progress. Afterwards you can resume {{ checklist?.name ?? 'this checklist' }} or go straight to pre-match.</p>
    <label class="field"><span>What needs repair? (optional)</span><input v-model="repairNote" placeholder="e.g. intake belt snapped" /></label>
    <template #actions>
      <span class="actions-spacer"></span>
      <md-text-button @click="repairOpen = false">Cancel</md-text-button>
      <md-filled-button :disabled="busy" @click="confirmRepair">Start repairs</md-filled-button>
    </template>
  </AppDialog>
</template>

<style scoped>
.progress {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 0.8rem;
}

.progress li {
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--accent-color);
  opacity: 0.6;
}

.progress li.done {
  opacity: 0.45;
  text-decoration: line-through;
}

.progress li.current {
  border-color: #ffc107;
  background: #ffc107;
  color: #1a1a1a;
  font-weight: 600;
  opacity: 1;
}

.checklist-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.eyebrow {
  margin: 0;
  font-size: 0.8rem;
  opacity: 0.7;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.checklist-header h2 {
  margin: 2px 0 0;
  font-size: 1.5rem;
}

.elapsed {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.elapsed-value {
  font-size: 2rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.elapsed-label {
  font-size: 0.75rem;
  opacity: 0.7;
}

.steps {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-y: auto;
}

.step {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--accent-color);
  background: var(--background-color);
}

.step.active {
  border-color: #ffc107;
  box-shadow: 0 0 0 1px #ffc107;
}

.step.upcoming {
  opacity: 0.5;
}

/* Smart step that doesn't apply: checked off automatically, grayed out. */
.step.skipped {
  opacity: 0.45;
  border-style: dashed;
}

.step.skipped .step-title {
  text-decoration: line-through;
}

.marker {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid currentColor;
  font-size: 0.85rem;
  font-weight: 700;
}

.step.done .marker {
  border-color: #2e7d32;
  background: #2e7d32;
  color: #fff;
}

.step-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.step.done .step-title {
  opacity: 0.7;
}

.smart-badge {
  margin-left: 8px;
  padding: 0 6px;
  border-radius: 4px;
  border: 1px solid currentColor;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  vertical-align: middle;
  opacity: 0.75;
}

.step-meta {
  font-size: 0.75rem;
  opacity: 0.65;
}

.undo {
  padding: 4px 10px;
  border: 1px solid var(--accent-color);
  border-radius: 6px;
  background: transparent;
  color: var(--primary-text-color);
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.repair-row {
  display: flex;
  justify-content: flex-end;
  margin-top: auto;
  padding-top: 4px;
}

.repair-button {
  padding: 10px 18px;
  border: 2px solid #c62828;
  border-radius: 10px;
  background: transparent;
  color: #ef5350;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.repair-button:hover {
  background: rgba(198, 40, 40, 0.12);
}

.area-step {
  gap: 12px;
}

.active-title {
  margin: 0;
  font-size: clamp(1.5rem, 2.6vw, 2.2rem);
  line-height: 1.15;
}

.smart-note {
  margin: 0;
  padding: 8px 12px;
  border-radius: 8px;
  border-left: 4px solid #ffc107;
  background: var(--background-color);
  font-weight: 600;
}

.instructions {
  margin: 0;
  font-size: 1.05rem;
  line-height: 1.45;
  white-space: pre-wrap;
}

.roles h3 {
  margin: 0 0 6px;
  font-size: 0.8rem;
  opacity: 0.7;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.roles ul {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.roles li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--background-color);
}

.role-name {
  opacity: 0.8;
}

.assignee {
  font-weight: 700;
}

.assignee.unassigned {
  font-weight: 400;
  font-style: italic;
  opacity: 0.6;
}

.grow {
  flex: 1;
}

.primary-action {
  padding: 18px 24px;
  border: none;
  border-radius: 14px;
  background: #2e7d32;
  color: #fff;
  font: inherit;
  font-size: 1.3rem;
  font-weight: 700;
  cursor: pointer;
  touch-action: manipulation;
}

.primary-action.small {
  padding: 10px 18px;
  font-size: 1rem;
}

.primary-action:disabled {
  opacity: 0.6;
}

.setup-link {
  align-self: flex-end;
}
</style>
