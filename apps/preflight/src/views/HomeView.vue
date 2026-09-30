<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { useLiveQuery } from '@/lib/live-query';
import { formatTime } from '@/lib/schedule/dates';
import { getActiveEvent, listScheduleItems } from '@/lib/schedule/schedule-repo';
import { scheduleItemColor, type ScheduleItem } from '@/lib/schedule/types';
import { useSessionStore } from '@/stores/session-store';

const session = useSessionStore();
const canViewSchedule = computed(() => session.hasRole('member'));

// Next few schedule entries that haven't finished yet.
const upNext = useLiveQuery<ScheduleItem[]>(async () => {
  const event = await getActiveEvent();
  if (!event) return [];
  const now = Date.now();
  return (await listScheduleItems(event.event_key))
    .filter((item) => Date.parse(item.end_at) > now)
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
    .slice(0, 5);
}, []);
</script>

<template>
  <div class="card">
    <h2>Welcome, {{ session.user?.name }}</h2>
    <p class="hint">More pit crew features are on the way.</p>
  </div>

  <div v-if="canViewSchedule" class="card">
    <div class="card-header">
      <h2>Up next</h2>
      <RouterLink to="/schedule" class="link">Open schedule →</RouterLink>
    </div>
    <ul v-if="upNext.length" class="up-next">
      <li v-for="item in upNext" :key="item.id">
        <span class="time">{{ formatTime(item.start_at) }}</span>
        <span class="dot" :style="{ background: scheduleItemColor(item) }"></span>
        <span>{{ item.title }}</span>
      </li>
    </ul>
    <p v-else class="hint">Nothing else scheduled.</p>
  </div>
</template>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.link {
  color: var(--header-hover-color);
}

.up-next {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.up-next li {
  display: flex;
  align-items: center;
  gap: 10px;
}

.time {
  min-width: 72px;
  opacity: 0.75;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: none;
}
</style>
