<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { formatClock } from '@greybots/common/lib/now';
import { checkStep, isStepDone, listChecks, nextStepIndex, uncheckStep, type ChecklistCheck } from '@/lib/checklists/checks';
import type { ChecklistSequence, PitRole } from '@/lib/checklists/config';
import { useLiveQuery } from '@/lib/live-query';
import { formatTime } from '@/lib/schedule/dates';
import { advanceChecklist, type RobotStatusEntry } from '@/lib/robot-status/robot-status';
import { useSessionStore } from '@/stores/session-store';

// The Pending state: the active checklist (steps done strictly in order) and,
// in its own panel, the active step's instructions and who holds each role.
// Finishing the last step loads the next checklist, or Robot Ready after the
// last one. Renders two panels (.area-checklist and .area-step) for the
// Overview grid to place.
const props = defineProps<{
  eventKey: string;
  entry: RobotStatusEntry;
  sequence: ChecklistSequence;
  roles: PitRole[];
  elapsedMs: number | null;
}>();
const session = useSessionStore();
const canAct = computed(() => session.hasRole('member'));
const canEditSetup = computed(() => session.hasRole('lead'));
const editor = () => session.user?.name ?? null;

const runId = computed(() => props.entry.run_id ?? '');
const checks = useLiveQuery<ChecklistCheck[]>(() => listChecks(props.eventKey, runId.value), [], runId);

const index = computed(() => props.entry.checklist_index ?? 0);
const checklist = computed(() => props.sequence.checklists[index.value] ?? null);
const nextIndex = computed(() => (checklist.value ? nextStepIndex(checks.value, checklist.value) : 0));
const activeStep = computed(() => checklist.value?.steps[nextIndex.value] ?? null);
const total = computed(() => props.sequence.checklists.length);

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

// Complete the active step; after the checklist's last step, move on.
function completeActive() {
  const list = checklist.value;
  const step = activeStep.value;
  if (!list || !step) return;
  return act(async () => {
    await checkStep(props.eventKey, runId.value, list, step, editor());
    const fresh = await listChecks(props.eventKey, runId.value);
    if (nextStepIndex(fresh, list) >= list.steps.length) {
      await advanceChecklist(props.eventKey, props.entry, props.sequence, editor());
    }
  });
}

// Undo the most recently completed step (steps stay in order).
function undoLast() {
  const list = checklist.value;
  const step = list?.steps[nextIndex.value - 1];
  if (!list || !step) return;
  return act(() => uncheckStep(runId.value, list, step, editor()));
}

// A checklist with no steps (or removed from the sequence mid-run) just
// needs a nudge onward.
const continueOn = () => act(() => advanceChecklist(props.eventKey, props.entry, props.sequence, editor()));
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
      <div class="elapsed" :title="'Time in this checklist'">
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
          :class="{ done: isStepDone(checks, checklist.id, step.id), active: i === nextIndex, upcoming: i > nextIndex }"
        >
          <span class="marker" aria-hidden="true">{{ isStepDone(checks, checklist.id, step.id) ? '✓' : i + 1 }}</span>
          <span class="step-text">
            <span class="step-title">{{ step.title }}</span>
            <span v-if="checkFor(step.id)" class="step-meta">
              {{ formatTime(checkFor(step.id)!.completed_at!) }}<template v-if="checkFor(step.id)!.completed_by_name"> · {{ checkFor(step.id)!.completed_by_name }}</template>
            </span>
          </span>
          <button v-if="canAct && i === nextIndex - 1" class="undo" :disabled="busy" @click="undoLast">Undo</button>
        </li>
      </ol>
    </template>
    <div v-else class="empty">
      <p class="hint">{{ checklist ? 'This checklist has no steps.' : "This checklist isn't in the sequence anymore." }}</p>
      <button v-if="canAct" class="primary-action" :disabled="busy" @click="continueOn">Continue</button>
    </div>
    <p v-if="error" class="error-text">{{ error }}</p>
  </section>

  <section class="panel area-step">
    <template v-if="activeStep">
      <p class="eyebrow">Step {{ nextIndex + 1 }} of {{ checklist!.steps.length }}</p>
      <h2 class="active-title">{{ activeStep.title }}</h2>
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
      <button v-if="canAct" class="primary-action" :disabled="busy" @click="completeActive">
        {{ nextIndex === checklist!.steps.length - 1 ? (index + 1 < total ? 'Done · next checklist' : 'Done · robot ready') : 'Done · next step' }}
      </button>
    </template>
    <p v-else class="hint">Waiting for the next checklist…</p>
    <RouterLink v-if="canEditSetup" to="/pit-setup" class="panel-link setup-link">Edit checklists and roles</RouterLink>
  </section>
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

.area-step {
  gap: 12px;
}

.active-title {
  margin: 0;
  font-size: clamp(1.5rem, 2.6vw, 2.2rem);
  line-height: 1.15;
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

.primary-action:disabled {
  opacity: 0.6;
}

.setup-link {
  align-self: flex-end;
}
</style>
