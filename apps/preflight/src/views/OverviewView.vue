<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import ChecklistRun from '@/components/overview/ChecklistRun.vue';
import NextMatchLine from '@/components/overview/NextMatchLine.vue';
import RepairPanel from '@/components/overview/RepairPanel.vue';
import ScheduleStrip from '@/components/overview/ScheduleStrip.vue';
import StatusHero from '@/components/overview/StatusHero.vue';
import RobotStatusDialog from '@/components/robot-status/RobotStatusDialog.vue';
import TaskList from '@/components/tasks/TaskList.vue';
import { useLiveQuery } from '@/lib/live-query';
import { markDeparted, markInbound, resumeChecklist, robotArrived } from '@/lib/robot-status/robot-status';
import { useRobotFlow } from '@/lib/robot-status/use-robot-flow';
import { getActiveEvent, listScheduleItems } from '@/lib/schedule/schedule-repo';
import { defaultMatchPrep, getMatchPrep, type MatchPrep } from '@/lib/schedule/timing';
import type { ActiveEvent, ScheduleItem } from '@/lib/schedule/types';
import { useSessionStore } from '@/stores/session-store';

// Mission-control landing page (issues #82, #84, #86). The layout follows the
// robot's status:
//   Inbound  - a big "Robot arrived" button
//   Pending  - the active checklist and its active step (tasks still on hand)
//   Repair   - red banner; resume the interrupted checklist or go to pre-match
//   Ready    - schedule and tasks, with "Robot departed"
//   Away     - same, with "Match over" (also automatic when the match ends)
const session = useSessionStore();
const isMember = computed(() => session.hasRole('member'));
const isLead = computed(() => session.hasRole('lead'));
const editor = () => session.user?.name ?? null;

const activeEvent = useLiveQuery<ActiveEvent | null>(getActiveEvent, null);
const eventKey = computed(() => activeEvent.value?.event_key ?? '');
const items = useLiveQuery<ScheduleItem[]>(() => (eventKey.value ? listScheduleItems(eventKey.value) : []), [], eventKey);
const matches = computed(() =>
  items.value.filter((i) => i.kind === 'match').sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
);

const flow = useRobotFlow(eventKey, matches);
const status = computed(() => flow.effective.value.status);

// The match the robot is heading to: the first one not yet over.
const departingFor = computed(() => matches.value.find((m) => Date.parse(m.end_at) > flow.now.value) ?? null);

// Countdown, prep, and queue deadlines for it (issue #80).
const prep = useLiveQuery<MatchPrep>(getMatchPrep, defaultMatchPrep);

const busy = ref(false);
const actionError = ref<string | null>(null);
async function act(action: () => Promise<unknown>) {
  actionError.value = null;
  busy.value = true;
  try {
    await action();
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
const onArrived = () => act(() => robotArrived(eventKey.value, flow.sequence.value, editor()));
const onDeparted = () => act(() => markDeparted(eventKey.value, departingFor.value?.match_key ?? null, editor()));
const onMatchOver = () => act(() => markInbound(eventKey.value, editor()));
const onResume = (index: number) =>
  act(() => resumeChecklist(eventKey.value, flow.latest.value!, index, flow.sequence.value, editor()));

const historyOpen = ref(false);
</script>

<template>
  <div v-if="!isMember" class="card">
    <h2>Welcome, {{ session.user?.name }}</h2>
    <p class="hint">Your account doesn't have pit crew access yet. Ask a lead or admin to make you a member.</p>
  </div>

  <div v-else-if="!activeEvent" class="card">
    <h2>No event set up</h2>
    <p class="hint">The pit flow, tasks, and schedule need an event.</p>
    <RouterLink to="/schedule" class="panel-link">Set up the event on the Schedule page →</RouterLink>
  </div>

  <div v-else-if="!flow.loaded.value" class="overview-loading hint">Loading…</div>

  <div v-else class="overview" :class="`state-${status}`">
    <p v-if="actionError" class="error-text area-notice">{{ actionError }}</p>

    <template v-if="status === 'pending' && flow.latest.value">
      <div class="pending-bar area-bar">
        <strong>Robot in the pit</strong>
        <span>{{ flow.sequence.value.checklists.length ? 'Working through checklists' : 'No checklists configured' }}</span>
        <span class="bar-spacer"></span>
        <NextMatchLine :match="departingFor" :prep="prep" :now="flow.now.value" />
        <button class="bar-link" @click="historyOpen = true">Status history</button>
      </div>
      <ChecklistRun
        :event-key="eventKey"
        :entry="flow.latest.value"
        :sequence="flow.sequence.value"
        :roles="flow.roles.value"
        :matches="matches"
        :now="flow.now.value"
        :elapsed-ms="flow.elapsedMs.value"
      />
      <TaskList class="area-tasks" :event-key="eventKey" :matches="matches" />
    </template>

    <template v-else-if="status === 'repair' && flow.latest.value">
      <RepairPanel
        class="area-hero"
        :entry="flow.latest.value"
        :sequence="flow.sequence.value"
        :elapsed-ms="flow.elapsedMs.value"
        :can-act="isMember"
        :busy="busy"
        :next-match="departingFor"
        :prep="prep"
        :now="flow.now.value"
        @resume="onResume"
        @history="historyOpen = true"
      />
      <TaskList class="area-tasks" :event-key="eventKey" :matches="matches" heading="Repair tasks" quick-add />
      <ScheduleStrip class="area-schedule" :event-key="eventKey" :items="items" />
    </template>

    <template v-else>
      <StatusHero
        class="area-hero"
        :effective="flow.effective.value"
        :elapsed-ms="flow.elapsedMs.value"
        :next-match="departingFor"
        :prep="prep"
        :now="flow.now.value"
        :can-act="isMember"
        :busy="busy"
        @arrived="onArrived"
        @departed="onDeparted"
        @match-over="onMatchOver"
        @history="historyOpen = true"
      />
      <TaskList class="area-tasks" :event-key="eventKey" :matches="matches" />
      <ScheduleStrip class="area-schedule" :event-key="eventKey" :items="items" />
    </template>

    <RobotStatusDialog
      :open="historyOpen"
      :event-key="eventKey"
      :history="flow.history.value ?? []"
      :current="status"
      :can-override="isLead"
      :sequence="flow.sequence.value"
      :next-match-key="departingFor?.match_key ?? null"
      @close="historyOpen = false"
    />
  </div>
</template>

<style scoped>
.overview {
  display: grid;
  width: 100%;
  gap: 12px;
  height: calc(100dvh - 64px - 3rem);
}

.overview-loading {
  padding: 2rem;
}

.area-notice { grid-area: notice; margin: 0; }
.area-bar { grid-area: bar; }
.area-hero { grid-area: hero; }
.area-tasks { grid-area: tasks; overflow-y: auto; }
.area-schedule { grid-area: schedule; }
.overview :deep(.area-checklist) { grid-area: checklist; }
.overview :deep(.area-step) { grid-area: step; }

/* Pit laptop / big screen. Empty "notice" rows collapse to nothing. */
/* Repairs: compact red strip on top, the repair task list front and center. */
.state-repair {
  grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
  grid-template-rows: auto auto minmax(0, 1fr);
  grid-template-areas:
    'notice notice'
    'hero hero'
    'tasks schedule';
}

.state-inbound {
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr) minmax(0, 1fr);
  grid-template-areas:
    'notice notice'
    'hero tasks'
    'hero schedule';
}

.state-pending {
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 0.8fr);
  grid-template-rows: auto auto minmax(0, 1fr);
  grid-template-areas:
    'notice notice notice'
    'bar bar bar'
    'checklist step tasks';
}

.state-ready,
.state-away {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  grid-template-rows: auto auto minmax(0, 1fr);
  grid-template-areas:
    'notice notice'
    'hero hero'
    'schedule tasks';
}

.pending-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-radius: 10px;
  background: #ffc107;
  color: #1a1a1a;
}

.bar-spacer {
  flex: 1;
}

.bar-link {
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 0.85rem;
  text-decoration: underline;
  cursor: pointer;
}

/* Smaller laptop / tablet: two columns, primary panel first. */
@media (max-width: 1279px) {
  .overview {
    height: auto;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-rows: none;
  }

  .state-inbound,
  .state-repair {
    grid-template-areas:
      'notice notice'
      'hero hero'
      'tasks schedule';
  }

  .state-pending {
    grid-template-areas:
      'notice notice'
      'bar bar'
      'checklist step'
      'tasks tasks';
  }

  .state-ready,
  .state-away {
    grid-template-areas:
      'notice notice'
      'hero hero'
      'tasks schedule';
  }

  .area-hero {
    min-height: 260px;
  }

  /* The repair strip stays compact so the repair tasks get the space. */
  .state-repair .area-hero {
    min-height: 0;
  }

  .area-schedule {
    min-height: 480px;
  }
}

/* Phone / tablet portrait: one column. */
@media (max-width: 760px) {
  .overview {
    grid-template-columns: minmax(0, 1fr);
  }

  .state-inbound,
  .state-repair {
    grid-template-areas: 'notice' 'hero' 'tasks' 'schedule';
  }

  .state-pending {
    grid-template-areas: 'notice' 'bar' 'step' 'checklist' 'tasks';
  }

  .state-ready,
  .state-away {
    grid-template-areas: 'notice' 'hero' 'tasks' 'schedule';
  }

  .area-schedule {
    height: 480px;
    min-height: 0;
  }
}
</style>
