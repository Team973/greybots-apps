<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { formatClock } from '@greybots/common/lib/now';
import BatteryScanner from '@/components/batteries/BatteryScanner.vue';
import RepairDialog from '@/components/repairs/RepairDialog.vue';
import { formatReading, installBattery, recommendBattery } from '@/lib/batteries/batteries';
import { useBatteries } from '@/lib/batteries/use-batteries';
import { checkStep, listChecks, uncheckStep, type ChecklistCheck } from '@/lib/checklists/checks';
import { stepInput, type ChecklistDef, type PitRole } from '@/lib/checklists/config';
import { instanceTitle } from '@/lib/checklists/instances';
import { activeStepIndex, evaluateStep, stepState, type StepContext } from '@/lib/checklists/smart';
import { useLiveQuery } from '@/lib/live-query';
import { formatTime } from '@/lib/schedule/dates';
import type { ScheduleItem } from '@/lib/schedule/types';
import { useSessionStore } from '@/stores/session-store';

// Runs one checklist (issue #82): the steps, done strictly in order, and in
// its own panel the active step's instructions, who holds each role, and
// whatever the step records (text, pass/fail, or the installed battery).
// Smart steps that don't apply (e.g. no bumper swap needed) show as skipped.
// Used for the pit sequence on the Overview and for ad-hoc runs on the
// Checklists page; the parent decides what happens on `complete`.
// Renders two panels (.area-checklist and .area-step) for the parent's grid.
const props = withDefaults(
  defineProps<{
    eventKey: string;
    // The run the checked steps are recorded under.
    runId: string;
    checklist: ChecklistDef | null;
    // Shown when the checklist can't be found (e.g. removed mid-run).
    fallbackName?: string | null;
    // Small line above the name, e.g. "Checklist 1 of 2".
    eyebrow?: string | null;
    // The match this run belongs to: its name ("Qual 12") and key.
    matchLabel?: string | null;
    matchKey?: string | null;
    roles: PitRole[];
    matches: ScheduleItem[];
    now: number;
    elapsedMs: number | null;
    // What the Done button says when it finishes the checklist.
    finishLabel?: string;
    // Offer "Repairs" (pauses the pit flow).
    canRepair?: boolean;
  }>(),
  { fallbackName: null, eyebrow: null, matchLabel: null, matchKey: null, finishLabel: 'Done · finish checklist', canRepair: false }
);
const emit = defineEmits<{ complete: []; repairs: [] }>();

const session = useSessionStore();
const canAct = computed(() => session.hasRole('member'));
const canEditSetup = computed(() => session.hasRole('lead'));
const editor = () => session.user?.name ?? null;

const runId = computed(() => props.runId);
const checks = useLiveQuery<ChecklistCheck[]>(() => listChecks(props.eventKey, runId.value), [], runId);
const ctx = computed<StepContext>(() => ({ matches: props.matches, now: props.now }));

const states = computed(() => (props.checklist ? props.checklist.steps.map((s) => stepState(checks.value, props.checklist!, s, ctx.value)) : []));
const nextIndex = computed(() => (props.checklist ? activeStepIndex(checks.value, props.checklist, ctx.value) : 0));
const activeStep = computed(() => props.checklist?.steps[nextIndex.value] ?? null);
const activeInput = computed(() => (activeStep.value ? stepInput(activeStep.value) : 'check'));
const activeNote = computed(() => (activeStep.value ? evaluateStep(activeStep.value, ctx.value).note : null));
const isComplete = computed(() => !!props.checklist && props.checklist.steps.length > 0 && nextIndex.value >= props.checklist.steps.length);
// The last step that was actually done (not skipped), for Undo.
const undoIndex = computed(() => {
  for (let i = nextIndex.value - 1; i >= 0; i--) if (states.value[i] === 'done') return i;
  return -1;
});

// What happens after the active step: counts only steps still to do.
const doneLabel = computed(() => {
  const remaining = states.value.slice(nextIndex.value + 1).filter((st) => st === 'todo').length;
  const next = remaining > 0 ? 'Done · next step' : props.finishLabel;
  // On a battery step, the button says which battery is being confirmed.
  return activeInput.value === 'battery' && chosenBattery.value ? next.replace('Done', `Battery ${chosenBattery.value.number} installed`) : next;
});

const rolesById = computed(() => new Map(props.roles.map((r) => [r.id, r])));
const activeRoles = computed(() =>
  (activeStep.value?.role_ids ?? []).map((id) => rolesById.value.get(id)).filter((r): r is PitRole => !!r)
);

function checkFor(stepId: string) {
  return checks.value.find((c) => c.checklist_id === props.checklist?.id && c.step_id === stepId && c.completed_at) ?? null;
}

// How a recorded value reads in the step list.
function valueLabel(check: ChecklistCheck, input: string): string | null {
  if (!check.value) return null;
  if (input === 'pass_fail') return check.value === 'fail' ? 'Fail' : 'Pass';
  if (input === 'battery') return `Battery ${check.value}`;
  return check.value;
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

// --- What the active step records ---
const text = ref('');
const batteryId = ref('');
const scanOpen = ref(false);
const { loaded: batteriesLoaded, batteries, readings, uses } = useBatteries();
const usable = computed(() => batteries.value.filter((b) => b.status !== 'retired'));
const chosenBattery = computed(() => usable.value.find((b) => b.id === batteryId.value) ?? null);
// The next battery in the rotation after the one installed most recently.
const recommended = computed(() => recommendBattery(batteries.value, uses.value));
const lastInstalled = computed(() => batteries.value.find((b) => b.id === uses.value[0]?.battery_id) ?? null);
// What the recommendation was when this step came up. It's kept for the whole
// step, since installing a battery moves the rotation on.
const suggested = ref<{ id: string; number: number; after: number | null } | null>(null);
watch(
  () => activeStep.value?.id,
  () => {
    text.value = '';
    batteryId.value = '';
    suggested.value = null;
  },
  { immediate: true }
);
// A battery step starts on the recommended battery, so confirming it is one
// tap; any other battery can be picked or scanned instead. (Set once per
// step, once the registry and the usage history have both loaded: the
// recommendation depends on which battery went in last.)
watch(
  () => [activeStep.value?.id, activeInput.value, batteriesLoaded.value, recommended.value?.id] as const,
  () => {
    if (activeInput.value !== 'battery' || suggested.value || !batteriesLoaded.value || !recommended.value) return;
    suggested.value = { id: recommended.value.id, number: recommended.value.number, after: lastInstalled.value?.number ?? null };
    if (!batteryId.value) batteryId.value = recommended.value.id;
  },
  { immediate: true }
);

function batteryOption(id: string): string {
  const b = batteries.value.find((x) => x.id === id);
  if (!b) return '';
  const r = readings.value.get(id);
  const parts = [`Battery ${b.number}`];
  if (r?.resting_voltage !== null && r?.resting_voltage !== undefined) parts.push(`${formatReading(r.resting_voltage, 2)} V`);
  if (r?.state_of_charge !== null && r?.state_of_charge !== undefined) parts.push(`${formatReading(r.state_of_charge, 0)}%`);
  if (b.status === 'suspect') parts.push('suspect');
  return parts.join(' · ');
}

function onScanned(number: number) {
  scanOpen.value = false;
  const found = usable.value.find((b) => b.number === number);
  if (found) batteryId.value = found.id;
  else error.value = `Battery ${number} isn't registered (or is retired). Add it on the Batteries page.`;
}

// Complete the active step, recording `value` if the step captures one; once
// nothing is left to do, tell the parent.
function completeActive(value: string | null = null) {
  const list = props.checklist;
  const step = activeStep.value;
  if (!list || !step) return;
  return act(async () => {
    let recorded = value;
    if (activeInput.value === 'text') recorded = text.value;
    if (activeInput.value === 'battery') {
      const battery = usable.value.find((b) => b.id === batteryId.value);
      if (!battery) throw new Error('Choose the battery that went in the robot');
      // Recording the battery also assigns it to this run's match.
      await installBattery(
        battery.id,
        {
          event_key: props.eventKey,
          kind: props.matchKey ? 'match' : 'test',
          match_key: props.matchKey,
          label: props.matchLabel ?? list.name,
          run_id: props.runId
        },
        editor()
      );
      recorded = String(battery.number);
    }
    await checkStep(props.eventKey, props.runId, list, step, editor(), { value: recorded, matchKey: props.matchKey });
    const fresh = await listChecks(props.eventKey, props.runId);
    if (activeStepIndex(fresh, list, ctx.value) >= list.steps.length) emit('complete');
  });
}

function undoLast() {
  const list = props.checklist;
  const step = list?.steps[undoIndex.value];
  if (!list || !step) return;
  return act(() => uncheckStep(props.runId, list, step, editor()));
}

// Log something to fix later without leaving the checklist (issue #83). It's
// linked to this run and to the match the robot just played.
const repairOpen = ref(false);
const lastMatchKey = computed(
  () => [...props.matches].reverse().find((m) => Date.parse(m.start_at) <= props.now)?.match_key ?? null
);
</script>

<template>
  <section class="panel area-checklist">
    <slot name="progress" />
    <header class="checklist-header">
      <div>
        <p v-if="eyebrow" class="eyebrow">{{ eyebrow }}</p>
        <h2>{{ instanceTitle(checklist?.name ?? fallbackName ?? 'Checklist', matchLabel) }}</h2>
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
          :class="[states[i], { active: i === nextIndex, upcoming: i > nextIndex && states[i] === 'todo', failed: checkFor(step.id)?.value === 'fail' }]"
        >
          <span class="marker" aria-hidden="true">{{ states[i] === 'done' ? (checkFor(step.id)?.value === 'fail' ? '✕' : '✓') : states[i] === 'skipped' ? '–' : i + 1 }}</span>
          <span class="step-text">
            <span class="step-title">{{ step.title }}<span v-if="step.condition" class="smart-badge">Smart</span></span>
            <span v-if="states[i] === 'done' && checkFor(step.id)" class="step-meta">
              {{ formatTime(checkFor(step.id)!.completed_at!) }}<template v-if="checkFor(step.id)!.completed_by_name"> · {{ checkFor(step.id)!.completed_by_name }}</template>
              <template v-if="valueLabel(checkFor(step.id)!, stepInput(step))"> · <span class="step-value">{{ valueLabel(checkFor(step.id)!, stepInput(step)) }}</span></template>
            </span>
            <span v-else-if="states[i] === 'skipped'" class="step-meta">Skipped · {{ evaluateStep(step, ctx).note }}</span>
          </span>
          <button v-if="canAct && i === undoIndex" class="undo" :disabled="busy" @click="undoLast">Undo</button>
        </li>
      </ol>
    </template>
    <div v-if="!checklist || !checklist.steps.length || isComplete" class="empty">
      <p class="hint">
        {{ !checklist ? "This checklist isn't available anymore." : !checklist.steps.length ? 'This checklist has no steps.' : 'Everything here is done.' }}
      </p>
      <button v-if="canAct" class="primary-action small" :disabled="busy" @click="emit('complete')">Continue</button>
    </div>
    <!-- The big ways out of this checklist: whatever the parent offers (e.g.
         the practice field), then Repairs. -->
    <div v-if="canAct && (canRepair || $slots.actions)" class="repair-row">
      <slot name="actions" />
      <button v-if="canRepair" class="repair-button" :disabled="busy" @click="emit('repairs')">Repairs</button>
    </div>
    <slot name="footer" />
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

      <label v-if="canAct && activeInput === 'text'" class="field record">
        <span>Record</span>
        <textarea v-model="text" rows="3" placeholder="Type what was said or found"></textarea>
      </label>
      <div v-if="canAct && activeInput === 'battery'" class="record">
        <p v-if="suggested" class="recommend" :class="{ changed: batteryId !== suggested.id }">
          <span class="recommend-label">Next up</span>
          <strong>Battery {{ suggested.number }}</strong>
          <span v-if="suggested.after !== null && suggested.after !== suggested.number">after Battery {{ suggested.after }}</span>
          <button v-if="batteryId !== suggested.id" type="button" class="use-recommended" @click="batteryId = suggested.id">Use it</button>
        </p>
        <label class="field">
          <span>Battery going in the robot (change it if you're installing a different one)</span>
          <span class="battery-row">
            <select v-model="batteryId">
              <option value="" disabled>Choose a battery</option>
              <option v-for="b in usable" :key="b.id" :value="b.id">{{ batteryOption(b.id) }}</option>
            </select>
            <button type="button" class="scan" @click="scanOpen = true">Scan</button>
          </span>
        </label>
        <p v-if="!usable.length" class="hint">No batteries registered. <RouterLink to="/batteries" class="panel-link">Add them on the Batteries page.</RouterLink></p>
      </div>

      <span class="grow"></span>
      <button v-if="canAct" class="log-repair" @click="repairOpen = true">Log a repair for later</button>
      <div v-if="canAct && activeInput === 'pass_fail'" class="pass-fail">
        <button class="primary-action fail" :disabled="busy" @click="completeActive('fail')">Fail</button>
        <button class="primary-action" :disabled="busy" @click="completeActive('pass')">Pass</button>
      </div>
      <button v-else-if="canAct" class="primary-action" :disabled="busy || (activeInput === 'battery' && !batteryId)" @click="completeActive()">{{ doneLabel }}</button>
    </template>
    <p v-else class="hint">Nothing left in this checklist.</p>
    <RouterLink v-if="canEditSetup" to="/pit-setup" class="panel-link setup-link">Edit checklists and roles</RouterLink>

    <RepairDialog
      :open="repairOpen"
      :event-key="eventKey"
      :repair="null"
      :matches="matches"
      :can-edit="canAct"
      :origin="{ source: 'checklist', run_id: runId }"
      :preset="{ match_key: lastMatchKey }"
      @close="repairOpen = false"
    />
    <BatteryScanner :open="scanOpen" title="Scan the battery going in" @close="scanOpen = false" @scanned="onScanned" />
  </section>
</template>

<style scoped>
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

/* A step that was completed with "Fail" stands out in the list. */
.step.failed {
  border-color: #c62828;
}

.step.failed .marker {
  border-color: #c62828;
  background: #c62828;
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
  overflow-wrap: anywhere;
}

.step-value {
  font-weight: 700;
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

/* Full width of the panel, so it's easy to hit in a hurry. */
.repair-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: auto;
  padding-top: 4px;
}

/* Buttons the parent adds to the row share the width with Repairs. */
.repair-row > :deep(*) {
  flex: 1 1 160px;
}

.repair-button {
  flex: 1 1 160px;
  padding: 16px 20px;
  border: 2px solid #c62828;
  border-radius: 12px;
  background: transparent;
  color: #ef5350;
  font: inherit;
  font-size: 1.2rem;
  font-weight: 700;
  cursor: pointer;
  touch-action: manipulation;
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

/* The value the step records. `flex: none` so .field's flex-basis (meant for
   form rows) doesn't stretch it down this column. */
.record {
  flex: none;
}

.record textarea,
.record select {
  font-size: 1.05rem;
}

.recommend {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  margin: 0 0 8px;
  padding: 10px 12px;
  border-radius: 8px;
  border-left: 4px solid #2e7d32;
  background: var(--background-color);
}

.recommend strong {
  font-size: 1.6rem;
  line-height: 1;
}

.recommend-label {
  font-size: 0.8rem;
  opacity: 0.7;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* A different battery was picked: the suggestion steps back. */
.recommend.changed {
  border-left-color: var(--accent-color);
}

.recommend.changed strong {
  opacity: 0.6;
}

.use-recommended {
  margin-left: auto;
  padding: 2px 10px;
  border: 1px solid var(--accent-color);
  border-radius: 6px;
  background: transparent;
  color: var(--primary-text-color);
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}

.battery-row {
  display: flex;
  gap: 6px;
  opacity: 1;
}

.battery-row select {
  flex: 1;
  min-width: 0;
}

.scan {
  flex: none;
  padding: 0 14px;
  border: 1px solid var(--accent-color);
  border-radius: 6px;
  background: transparent;
  color: var(--primary-text-color);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.hint {
  margin: 0;
  opacity: 0.7;
}

.grow {
  flex: 1;
}

.log-repair {
  padding: 10px 16px;
  border: 1px solid var(--accent-color);
  border-radius: 10px;
  background: transparent;
  color: var(--primary-text-color);
  font: inherit;
  cursor: pointer;
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

.primary-action.fail {
  background: #c62828;
}

.primary-action:disabled {
  opacity: 0.6;
}

.pass-fail {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 8px;
}

.setup-link {
  align-self: flex-end;
}
</style>
