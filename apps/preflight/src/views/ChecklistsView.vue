<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { formatElapsed, useNow } from '@greybots/common/lib/now';
import ChecklistRunner from '@/components/checklists/ChecklistRunner.vue';
import { listAllChecks, type ChecklistCheck } from '@/lib/checklists/checks';
import { getAdhocChecklists, getPitRoles, type ChecklistDef, type PitRole } from '@/lib/checklists/config';
import { buildInstances, instanceTitle, matchContext, resolveMatchLink, type ChecklistInstance } from '@/lib/checklists/instances';
import { completeChecklistRun, deleteChecklistRun, listChecklistRuns, startChecklistRun, type ChecklistRun } from '@/lib/checklists/runs';
import { useLiveQuery } from '@/lib/live-query';
import { listStatusHistory, type RobotStatusEntry } from '@/lib/robot-status/robot-status';
import { formatTime } from '@/lib/schedule/dates';
import { getActiveEvent, listScheduleItems } from '@/lib/schedule/schedule-repo';
import type { ActiveEvent, ScheduleItem } from '@/lib/schedule/types';
import { useSessionStore } from '@/stores/session-store';

// Checklists page (issue #82): start an ad-hoc checklist (start of day, a
// bumper swap, a subsystem deep dive), finish the ones in progress, and
// review every checklist run at the event: when it started and finished, and
// who did each step. The standard pit sequence itself runs on the Overview.
const session = useSessionStore();
const canAct = computed(() => session.hasRole('member'));
const canEditSetup = computed(() => session.hasRole('lead'));
const editor = () => session.user?.name ?? null;
const now = useNow(1000);

const activeEvent = useLiveQuery<ActiveEvent | null>(getActiveEvent, null);
const eventKey = computed(() => activeEvent.value?.event_key ?? '');
const items = useLiveQuery<ScheduleItem[]>(() => (eventKey.value ? listScheduleItems(eventKey.value) : []), [], eventKey);
const matches = computed(() =>
  items.value.filter((i) => i.kind === 'match').sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
);

const templates = useLiveQuery<ChecklistDef[]>(getAdhocChecklists, []);
const roles = useLiveQuery<PitRole[]>(getPitRoles, []);
const runs = useLiveQuery<ChecklistRun[]>(() => (eventKey.value ? listChecklistRuns(eventKey.value) : []), [], eventKey);
const checks = useLiveQuery<ChecklistCheck[]>(() => (eventKey.value ? listAllChecks(eventKey.value) : []), [], eventKey);
const statusLog = useLiveQuery<RobotStatusEntry[]>(() => (eventKey.value ? listStatusHistory(eventKey.value) : []), [], eventKey);

const openRuns = computed(() => runs.value.filter((r) => !r.completed_at));
const activeRunId = ref<string | null>(null);
// The run being worked on: the one picked, else the only one in progress.
const activeRun = computed(() => openRuns.value.find((r) => r.id === activeRunId.value) ?? (openRuns.value.length === 1 ? openRuns.value[0] : null));

const error = ref<string | null>(null);
async function act(action: () => Promise<unknown>) {
  error.value = null;
  try {
    await action();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

// The match a new run would belong to, from the checklist's "Belongs to".
const linkFor = (checklist: ChecklistDef) => resolveMatchLink(checklist.match_link ?? 'none', matchContext(matches.value, now.value));

const start = (checklist: ChecklistDef) =>
  act(async () => {
    const run = await startChecklistRun(eventKey.value, checklist, linkFor(checklist), editor());
    activeRunId.value = run.id;
  });

const finish = (run: ChecklistRun) => act(() => completeChecklistRun(run.id, editor()));

function abandon(run: ChecklistRun) {
  if (confirm(`Discard this run of "${run.checklist_name}"? Its checked steps won't be kept in the history.`)) act(() => deleteChecklistRun(run.id));
}

// --- History ---
const instances = computed(() => buildInstances(checks.value, runs.value, statusLog.value, matches.value));
// Finished runs only: the ones in progress are shown above.
const history = computed(() => instances.value.filter((i) => i.kind === 'flow' || i.completedAt));
const expanded = ref<Set<string>>(new Set());
function toggle(key: string) {
  const next = new Set(expanded.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expanded.value = next;
}

function day(iso: string) {
  return new Date(iso).toLocaleDateString([], { weekday: 'short' });
}

function summary(instance: ChecklistInstance): string {
  const parts = [`${day(instance.startedAt)} ${formatTime(instance.startedAt)}`];
  if (instance.completedAt) {
    parts[0] += ` – ${formatTime(instance.completedAt)}`;
    parts.push(formatElapsed(Date.parse(instance.completedAt) - Date.parse(instance.startedAt)));
  }
  parts.push(`${instance.checks.length} step${instance.checks.length === 1 ? '' : 's'}`);
  const failed = instance.checks.filter((c) => c.value === 'fail').length;
  if (failed) parts.push(`${failed} failed`);
  return parts.join(' · ');
}

function valueText(check: ChecklistCheck): string | null {
  if (!check.value) return null;
  if (check.value === 'pass') return 'Pass';
  if (check.value === 'fail') return 'Fail';
  return check.value;
}
</script>

<template>
  <div v-if="!activeEvent" class="card">
    <h2>No event set up</h2>
    <p class="hint">Checklist runs are kept per event.</p>
    <RouterLink to="/schedule" class="panel-link">Set up the event on the Schedule page →</RouterLink>
  </div>

  <div v-else class="checklists-view">
    <header class="page-header">
      <h1>Checklists</h1>
      <p class="hint">
        The post-match and pre-match checklists run on the <RouterLink to="/" class="panel-link">Overview</RouterLink> each time the robot
        comes back. Start any other checklist here.
      </p>
    </header>
    <p v-if="error" class="error-text">{{ error }}</p>

    <section class="panel">
      <header class="panel-header">
        <h2>Start a checklist</h2>
        <RouterLink v-if="canEditSetup" to="/pit-setup" class="panel-link">Edit checklists</RouterLink>
      </header>
      <div v-if="templates.length" class="templates">
        <button v-for="checklist in templates" :key="checklist.id" class="template" :disabled="!canAct" @click="start(checklist)">
          <span class="template-name">{{ instanceTitle(checklist.name || 'Untitled checklist', linkFor(checklist).label) }}</span>
          <span class="template-meta">{{ checklist.steps.length }} step{{ checklist.steps.length === 1 ? '' : 's' }}</span>
        </button>
      </div>
      <p v-else class="hint">
        No other checklists are set up.
        <template v-if="canEditSetup"> Add them (start of day, bumper swap, deep dives) on Pit setup.</template>
        <template v-else> A lead or admin can add them on Pit setup.</template>
      </p>
    </section>

    <section v-if="openRuns.length > 1" class="panel">
      <header class="panel-header"><h2>In progress</h2></header>
      <div class="templates">
        <button v-for="run in openRuns" :key="run.id" class="template" :class="{ on: run.id === activeRun?.id }" @click="activeRunId = run.id">
          <span class="template-name">{{ instanceTitle(run.checklist_name, run.label) }}</span>
          <span class="template-meta">Started {{ formatTime(run.started_at) }}<template v-if="run.started_by_name"> by {{ run.started_by_name }}</template></span>
        </button>
      </div>
    </section>

    <div v-if="activeRun" class="runner">
      <ChecklistRunner
        :key="activeRun.id"
        :event-key="eventKey"
        :run-id="activeRun.id"
        :checklist="activeRun.snapshot"
        eyebrow="In progress"
        :match-label="activeRun.label"
        :match-key="activeRun.match_key"
        :roles="roles"
        :matches="matches"
        :now="now"
        :elapsed-ms="now - Date.parse(activeRun.started_at)"
        @complete="finish(activeRun)"
      >
        <template #footer>
          <button v-if="canAct" class="discard" @click="abandon(activeRun)">Discard this run</button>
        </template>
      </ChecklistRunner>
    </div>

    <section class="panel">
      <header class="panel-header">
        <h2>History</h2>
        <span class="hint">{{ history.length }} run{{ history.length === 1 ? '' : 's' }}</span>
      </header>
      <ul class="history">
        <li v-for="instance in history" :key="instance.key" class="instance">
          <button class="instance-head" :aria-expanded="expanded.has(instance.key)" @click="toggle(instance.key)">
            <span class="instance-name">{{ instanceTitle(instance.name, instance.label) }}</span>
            <span class="instance-meta">{{ summary(instance) }}</span>
            <span class="chevron" aria-hidden="true">{{ expanded.has(instance.key) ? '▲' : '▼' }}</span>
          </button>
          <ol v-if="expanded.has(instance.key)" class="instance-steps">
            <li v-for="check in instance.checks" :key="check.id" :class="{ failed: check.value === 'fail' }">
              <span class="when">{{ formatTime(check.completed_at!) }}</span>
              <span class="step-title">
                {{ check.step_title }}
                <span v-if="valueText(check)" class="step-value">{{ valueText(check) }}</span>
              </span>
              <span class="by">{{ check.completed_by_name }}</span>
            </li>
            <li v-if="!instance.checks.length" class="none">No steps were checked.</li>
          </ol>
        </li>
      </ul>
      <p v-if="!history.length" class="hint">No checklists have been run at this event yet.</p>
    </section>
  </div>
</template>

<style scoped>
.checklists-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 1200px;
}

.page-header h1 {
  margin: 0;
  font-size: 1.8rem;
}

.hint {
  margin: 0;
  opacity: 0.7;
  font-size: 0.9rem;
}

.page-header .hint {
  margin-top: 4px;
}

.templates {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.template {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 180px;
  padding: 10px 14px;
  border: 1px solid var(--accent-color);
  border-radius: 10px;
  background: var(--background-color);
  color: var(--primary-text-color);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.template:hover,
.template.on {
  border-color: #ffc107;
}

.template:disabled {
  cursor: default;
  opacity: 0.6;
}

.template-name {
  font-weight: 600;
}

.template-meta {
  font-size: 0.8rem;
  opacity: 0.7;
}

/* The same two panels as on the Overview: steps, then the active step. */
.runner {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 12px;
  min-height: 420px;
}

@media (max-width: 760px) {
  .runner {
    grid-template-columns: minmax(0, 1fr);
  }
}

.discard {
  align-self: flex-start;
  padding: 0;
  border: none;
  background: none;
  color: var(--primary-text-color);
  opacity: 0.7;
  font: inherit;
  font-size: 0.85rem;
  text-decoration: underline;
  cursor: pointer;
}

.history,
.instance-steps {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.instance {
  border-radius: 10px;
  border: 1px solid var(--accent-color);
  background: var(--background-color);
}

.instance-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 12px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.instance-name {
  font-weight: 600;
}

.instance-meta {
  flex: 1;
  font-size: 0.85rem;
  opacity: 0.7;
}

.chevron {
  font-size: 0.8rem;
  opacity: 0.7;
}

.instance-steps {
  padding: 0 12px 10px;
}

.instance-steps li {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 0.9rem;
}

.instance-steps li.failed .step-value {
  color: #ef5350;
}

.when,
.by {
  flex: none;
  font-size: 0.8rem;
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
}

.step-title {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.step-value {
  margin-left: 6px;
  font-weight: 700;
}

.none {
  opacity: 0.7;
}
</style>
