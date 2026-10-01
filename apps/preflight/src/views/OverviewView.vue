<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import CountdownTimer from '@/components/overview/CountdownTimer.vue';
import ScheduleStrip from '@/components/overview/ScheduleStrip.vue';
import RobotStatusCard from '@/components/robot-status/RobotStatusCard.vue';
import TaskList from '@/components/tasks/TaskList.vue';
import { useLiveQuery } from '@/lib/live-query';
import { useNow } from '@/lib/now';
import { getActiveEvent, listScheduleItems } from '@/lib/schedule/schedule-repo';
import type { ActiveEvent, ScheduleItem } from '@/lib/schedule/types';
import { useSessionStore } from '@/stores/session-store';

// Mission-control landing page (issue #86, Overview mockup).
const session = useSessionStore();
const isMember = computed(() => session.hasRole('member'));

const activeEvent = useLiveQuery<ActiveEvent | null>(getActiveEvent, null);
const eventKey = computed(() => activeEvent.value?.event_key ?? null);
const items = useLiveQuery<ScheduleItem[]>(() => (eventKey.value ? listScheduleItems(eventKey.value) : []), [], eventKey);

const now = useNow(30_000);
const matches = computed(() =>
  items.value.filter((i) => i.kind === 'match').sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
);
const nextMatch = computed(() => {
  const next = matches.value.find((m) => Date.parse(m.start_at) > now.value);
  return next ? { title: next.title, start: next.start_at } : null;
});
</script>

<template>
  <div v-if="!isMember" class="card">
    <h2>Welcome, {{ session.user?.name }}</h2>
    <p class="hint">Your account doesn't have pit crew access yet. Ask a lead or admin to make you a member.</p>
  </div>

  <div v-else class="overview">
    <p v-if="!activeEvent" class="card no-event">
      No event is set up yet, so tasks and robot status are unavailable.
      <RouterLink to="/schedule" class="panel-link">Set up the event on the Schedule page →</RouterLink>
    </p>

    <ScheduleStrip class="area-schedule" :event-key="eventKey" :items="items" />

    <section class="panel area-checklists">
      <header class="panel-header"><h2>Checklists</h2></header>
      <p class="hint">Pre-match, post-match, and start-of-day checklists are coming soon.</p>
    </section>

    <TaskList v-if="eventKey" class="area-tasks" :event-key="eventKey" :matches="matches" />
    <RobotStatusCard v-if="eventKey" class="area-status" :event-key="eventKey" />
    <CountdownTimer class="area-timer" :next-match="nextMatch" />
  </div>
</template>

<style scoped>
/* Pit laptop / big screen: the mockup's layout, filling the viewport. */
.overview {
  display: grid;
  width: 100%;
  gap: 12px;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr) minmax(0, 0.85fr) minmax(0, 0.85fr);
  grid-template-rows: auto minmax(0, 1fr) auto;
  grid-template-areas:
    'notice notice notice notice'
    'schedule checklists tasks tasks'
    'schedule checklists status timer';
  height: calc(100dvh - 64px - 3rem);
}

.no-event {
  grid-area: notice;
  max-width: none;
  margin: 0;
  display: block;
}

.area-schedule { grid-area: schedule; }
.area-checklists { grid-area: checklists; }
.area-tasks { grid-area: tasks; overflow-y: auto; }
.area-status { grid-area: status; }
.area-timer { grid-area: timer; }

/* Smaller laptop / tablet landscape: two columns, at-a-glance panels on top. */
@media (max-width: 1279px) {
  .overview {
    height: auto;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-rows: none;
    grid-template-areas:
      'notice notice'
      'status timer'
      'tasks schedule'
      'checklists schedule';
  }

  .area-schedule {
    min-height: 520px;
  }
}

/* Phone / tablet portrait: one column. */
@media (max-width: 760px) {
  .overview {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'notice'
      'status'
      'timer'
      'tasks'
      'checklists'
      'schedule';
  }

  .area-schedule {
    height: 480px;
    min-height: 0;
  }
}
</style>
