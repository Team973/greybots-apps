<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import ChecklistRunner from '@/components/checklists/ChecklistRunner.vue';
import NextMatchLine from '@/components/overview/NextMatchLine.vue';
import RepairPanel from '@/components/overview/RepairPanel.vue';
import ScheduleStrip from '@/components/overview/ScheduleStrip.vue';
import StatusHero from '@/components/overview/StatusHero.vue';
import InstalledBatteryChip from '@/components/batteries/InstalledBatteryChip.vue';
import ActiveRepairChip from '@/components/repairs/ActiveRepairChip.vue';
import RepairList from '@/components/repairs/RepairList.vue';
import RobotStatusDialog from '@/components/robot-status/RobotStatusDialog.vue';
import TaskList from '@/components/tasks/TaskList.vue';
import { sequenceMatchLink } from '@/lib/checklists/config';
import { matchContext, resolveMatchLink } from '@/lib/checklists/instances';
import { useLiveQuery } from '@/lib/live-query';
import { activeRepairs, listRepairs, type Repair } from '@/lib/repairs/repairs';
import {
  advanceChecklist,
  canEndDay,
  canGoToPractice,
  canTakeBreak,
  departForPractice,
  endDay,
  flowChecklistOf,
  markDeparted,
  markInbound,
  resumeChecklist,
  resumePrevious,
  returnFromPractice,
  robotArrived,
  startBreak,
  startDay,
  startEndOfDay,
  startPracticeChecklist,
  startRepair
} from '@/lib/robot-status/robot-status';
import { useRobotFlow } from '@/lib/robot-status/use-robot-flow';
import { getActiveEvent, listScheduleItems } from '@/lib/schedule/schedule-repo';
import { defaultMatchPrep, getMatchPrep, type MatchPrep } from '@/lib/schedule/timing';
import type { ActiveEvent, ScheduleItem } from '@/lib/schedule/types';
import { useSessionStore } from '@/stores/session-store';

// Mission-control landing page (issues #82, #84, #86). The layout follows the
// robot's status:
//   Inbound  - a big "Robot arrived" button
//   Pending  - the active checklist and its active step (tasks still on hand)
//   Repair   - red banner; resume the interrupted checklist or go to pre-match;
//              the repair log takes over from the schedule
//   Ready    - schedule and tasks, with "Robot departed"
//   Practice - the practice field side trip: its checklist (Pending), then
//              "At practice field" until the robot is back for pre-match
//   Break    - paused; "Back to work" returns to exactly where the pit was
//   Day      - "End the day" runs the end of day checklist, then Day ended;
//              "Start day" runs the start of day checklist, then pre-match
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

// The last match we played: what a repair found in the pit is most likely from.
const lastMatch = computed(() => [...matches.value].reverse().find((m) => Date.parse(m.start_at) <= flow.now.value) ?? null);

// Repairs being worked on show next to the status in every state (issue #83).
const repairs = useLiveQuery<Repair[]>(() => (eventKey.value ? listRepairs(eventKey.value) : []), [], eventKey);
const repairsInProgress = computed(() => activeRepairs(repairs.value));

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

// The checklist the pit is on (Pending), and the match this run of it
// belongs to: post-match work goes with the match just played, pre-match
// with the next one (issue #82).
const checklistIndex = computed(() => flow.latest.value?.checklist_index ?? 0);
const checklistCount = computed(() => flow.sequence.value.checklists.length);
// Three checklists run outside the sequence, at fixed points in the flow: the
// practice field one, and the start and end of day ones.
const flowChecklist = computed(() => flowChecklistOf(flow.latest.value));
const onPracticeChecklist = computed(() => flowChecklist.value === 'practice');
const activeChecklist = computed(() => {
  switch (flowChecklist.value) {
    case 'practice':
      return flow.practice.value;
    case 'start_of_day':
      return flow.startOfDay.value;
    case 'end_of_day':
      return flow.endOfDay.value;
    default:
      return flow.sequence.value.checklists[checklistIndex.value] ?? null;
  }
});
const checklistLink = computed(() =>
  flowChecklist.value
    ? { label: null, matchKey: null }
    : resolveMatchLink(sequenceMatchLink(flow.sequence.value, checklistIndex.value), matchContext(matches.value, flow.now.value))
);
// How the active checklist is introduced, and what finishing it does.
const checklistEyebrow = computed(() => {
  switch (flowChecklist.value) {
    case 'practice':
      return 'Before the practice field';
    case 'start_of_day':
      return 'Starting the day';
    case 'end_of_day':
      return 'Ending the day';
    default:
      return activeChecklist.value ? `Checklist ${checklistIndex.value + 1} of ${checklistCount.value}` : null;
  }
});
const finishLabel = computed(() => {
  switch (flowChecklist.value) {
    case 'practice':
      return 'Done · to the practice field';
    case 'start_of_day':
      return 'Done · on to pre-match';
    case 'end_of_day':
      return 'Done · end the day';
    default:
      return checklistIndex.value + 1 < checklistCount.value ? 'Done · next checklist' : 'Done · robot ready';
  }
});
const barText = computed(() => {
  switch (flowChecklist.value) {
    case 'practice':
      return 'Getting ready for the practice field';
    case 'start_of_day':
      return 'Starting the day';
    case 'end_of_day':
      return 'Closing up for the day';
    default:
      return flow.sequence.value.checklists.length ? 'Working through checklists' : 'No checklists configured';
  }
});
// Finishing a sequence checklist loads the next one, or Robot Ready after the
// last. The others each lead somewhere of their own.
const onChecklistComplete = () =>
  act(() => {
    const entry = flow.latest.value!;
    switch (flowChecklist.value) {
      case 'practice':
        return departForPractice(eventKey.value, entry, editor());
      case 'start_of_day':
        return returnFromPractice(eventKey.value, flow.sequence.value, editor());
      case 'end_of_day':
        return endDay(eventKey.value, entry, editor());
      default:
        return advanceChecklist(eventKey.value, entry, flow.sequence.value, editor());
    }
  });

// Ending and starting the day, each with its checklist.
const canEnd = computed(() => !!flow.endOfDay.value && canEndDay(flow.latest.value, status.value));
const onEndDay = () => act(() => startEndOfDay(eventKey.value, flow.endOfDay.value!, editor()));
const onStartDay = () => act(() => startDay(eventKey.value, flow.startOfDay.value!, flow.sequence.value, editor()));
// A break pauses the pit while the robot isn't ready. Ending it (or calling
// off the end of the day) goes back to exactly where the pit was.
const canBreak = computed(() => canTakeBreak(status.value) && flowChecklist.value !== 'end_of_day');
const onBreak = () => act(() => startBreak(eventKey.value, flow.latest.value!, editor()));
const onResumePrevious = () => act(() => resumePrevious(eventKey.value, flow.latest.value!, editor()));

// The practice field is on offer once the robot is clear of post-match and
// not in repairs.
const canPractice = computed(() => !!flow.practice.value && canGoToPractice(flow.latest.value, status.value, flow.sequence.value));
const onPractice = () => act(() => startPracticeChecklist(eventKey.value, flow.practice.value!, editor()));
const onPracticeReturn = () => act(() => returnFromPractice(eventKey.value, flow.sequence.value, editor()));
// "Repairs" switches straight to Repair in progress (no prompt: repairs get
// logged and assigned from the repair screen).
const onRepairs = () => act(() => startRepair(eventKey.value, flow.latest.value!, editor()));

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

  <!-- "At practice field", "On break", and "Day ended" use Ready's layout. -->
  <div v-else class="overview" :class="`state-${['practice', 'break', 'day_ended'].includes(status) ? 'ready' : status}`">
    <p v-if="actionError" class="error-text area-notice">{{ actionError }}</p>

    <template v-if="status === 'pending' && flow.latest.value">
      <div class="pending-bar area-bar">
        <strong>Robot in the pit</strong>
        <span>{{ barText }}</span>
        <button v-if="isMember && canBreak" class="bar-button" :disabled="busy" @click="onBreak">Take a break</button>
        <button v-if="isMember && canEnd" class="bar-button" :disabled="busy" @click="onEndDay">End the day</button>
        <InstalledBatteryChip />
        <ActiveRepairChip :repairs="repairsInProgress" />
        <span class="bar-spacer"></span>
        <NextMatchLine :match="departingFor" :prep="prep" :now="flow.now.value" />
        <button class="bar-link" @click="historyOpen = true">Status history</button>
      </div>
      <ChecklistRunner
        :event-key="eventKey"
        :run-id="flow.latest.value.run_id ?? ''"
        :checklist="activeChecklist"
        :fallback-name="flow.latest.value.pending_label"
        :eyebrow="checklistEyebrow"
        :match-label="checklistLink.label"
        :match-key="checklistLink.matchKey"
        :roles="flow.roles.value"
        :matches="matches"
        :now="flow.now.value"
        :elapsed-ms="flow.elapsedMs.value"
        :finish-label="finishLabel"
        :can-repair="!flowChecklist || onPracticeChecklist"
        @complete="onChecklistComplete"
        @repairs="onRepairs"
      >
        <!-- Big buttons beside Repairs: out to the practice field, or the way
             back from a checklist that can be called off. -->
        <template v-if="isMember && (canPractice || onPracticeChecklist || flowChecklist === 'end_of_day')" #actions>
          <button v-if="onPracticeChecklist" class="flow-button prematch" :disabled="busy" @click="onPracticeReturn">Back to pre-match</button>
          <button v-else-if="flowChecklist === 'end_of_day'" class="flow-button prematch" :disabled="busy" @click="onResumePrevious">Not ending the day yet</button>
          <button v-else class="flow-button practice" :disabled="busy" @click="onPractice">Practice field</button>
        </template>
        <template v-if="!flowChecklist" #progress>
          <ol class="progress" aria-label="Checklist sequence">
            <li v-for="(c, i) in flow.sequence.value.checklists" :key="c.id" :class="{ done: i < checklistIndex, current: i === checklistIndex }">
              {{ c.name }}
            </li>
          </ol>
        </template>
      </ChecklistRunner>
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
        @break="onBreak"
        @history="historyOpen = true"
      />
      <RepairList
        class="area-tasks"
        :event-key="eventKey"
        :matches="matches"
        heading="Repairs"
        quick-add
        :origin="{ source: 'checklist', run_id: flow.latest.value.run_id }"
        :default-match-key="lastMatch?.match_key ?? null"
      />
      <TaskList class="area-schedule" :event-key="eventKey" :matches="matches" quick-add />
    </template>

    <template v-else>
      <StatusHero
        class="area-hero"
        :effective="flow.effective.value"
        :elapsed-ms="flow.elapsedMs.value"
        :next-match="departingFor"
        :prep="prep"
        :now="flow.now.value"
        :repairs="repairsInProgress"
        :can-act="isMember"
        :busy="busy"
        :can-practice="canPractice"
        :can-end-day="canEnd"
        @end-day="onEndDay"
        @start-day="onStartDay"
        @resume="onResumePrevious"
        @practice="onPractice"
        @practice-return="onPracticeReturn"
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
/* Repairs: compact red strip on top, the repair log front and center, tasks
   beside it. */
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

/* Small actions in the yellow bar: possible, but not the next thing to do. */
.bar-button {
  padding: 2px 10px;
  border: 1.5px solid #1a1a1a;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}

.bar-button:disabled {
  opacity: 0.6;
}

/* Same size as the runner's Repairs button, which they sit beside. */
.flow-button {
  padding: 16px 20px;
  border: 2px solid;
  border-radius: 12px;
  background: transparent;
  font: inherit;
  font-size: 1.2rem;
  font-weight: 700;
  cursor: pointer;
  touch-action: manipulation;
}

.flow-button:disabled {
  opacity: 0.6;
}

.flow-button.practice {
  border-color: #00838f;
  color: #26c6da;
}

.flow-button.practice:hover {
  background: rgba(0, 131, 143, 0.15);
}

.flow-button.prematch {
  border-color: #ffc107;
  color: #ffc107;
}

.flow-button.prematch:hover {
  background: rgba(255, 193, 7, 0.12);
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
