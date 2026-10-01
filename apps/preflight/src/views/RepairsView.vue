<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import RepairList from '@/components/repairs/RepairList.vue';
import { useLiveQuery } from '@/lib/live-query';
import { getActiveEvent, listScheduleItems } from '@/lib/schedule/schedule-repo';
import type { ActiveEvent, ScheduleItem } from '@/lib/schedule/types';

// Repairs page (issue #83): the event's whole repair and maintenance log,
// including finished work, for the pit and for post-event review.
const activeEvent = useLiveQuery<ActiveEvent | null>(getActiveEvent, null);
const eventKey = computed(() => activeEvent.value?.event_key ?? '');
const items = useLiveQuery<ScheduleItem[]>(() => (eventKey.value ? listScheduleItems(eventKey.value) : []), [], eventKey);
const matches = computed(() =>
  items.value.filter((i) => i.kind === 'match').sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
);
</script>

<template>
  <div v-if="!activeEvent" class="card">
    <h2>No event set up</h2>
    <p class="hint">The repair log is kept per event.</p>
    <RouterLink to="/schedule" class="panel-link">Set up the event on the Schedule page →</RouterLink>
  </div>
  <div v-else class="repairs-view">
    <RepairList :event-key="eventKey" :matches="matches" heading="Repair and maintenance log" show-done />
  </div>
</template>

<style scoped>
.repairs-view {
  width: 100%;
  max-width: 900px;
}
</style>
