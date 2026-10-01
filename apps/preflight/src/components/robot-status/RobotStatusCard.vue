<script setup lang="ts">
import { computed, ref } from 'vue';
import { formatClock } from '@greybots/common/lib/now';
import RobotStatusDialog from './RobotStatusDialog.vue';
import { robotStatusColors, robotStatusLabels, statusText } from '@/lib/robot-status/robot-status';
import { useRobotFlow } from '@/lib/robot-status/use-robot-flow';
import type { ScheduleItem } from '@/lib/schedule/types';
import { useSessionStore } from '@/stores/session-store';

// Compact, color-coded robot status for glanceable screens (e.g. the pit
// display, #90). The Overview uses the full-size StatusHero/ChecklistRun.
const props = defineProps<{ eventKey: string; matches: ScheduleItem[] }>();
const session = useSessionStore();

const eventKey = computed(() => props.eventKey);
const matches = computed(() => props.matches);
const flow = useRobotFlow(eventKey, matches);

const text = computed(() => {
  const { status, entry } = flow.effective.value;
  return status === 'pending' ? statusText(entry) : robotStatusLabels[status];
});
const colors = computed(() =>
  flow.loaded.value ? robotStatusColors[flow.effective.value.status] : { bg: 'var(--accent-color)', fg: 'inherit' }
);
const departingFor = computed(() => props.matches.find((m) => Date.parse(m.end_at) > flow.now.value) ?? null);
const dialogOpen = ref(false);
</script>

<template>
  <section class="panel status-panel">
    <header class="panel-header"><h2>Robot Status</h2></header>
    <button class="status-card" :style="{ background: colors.bg, color: colors.fg }" @click="dialogOpen = true">
      <span class="status-text">{{ flow.loaded.value ? text : '…' }}</span>
      <span v-if="flow.elapsedMs.value !== null" class="since">{{ formatClock(flow.elapsedMs.value) }}</span>
    </button>
    <RobotStatusDialog
      :open="dialogOpen"
      :event-key="eventKey"
      :history="flow.history.value ?? []"
      :current="flow.effective.value.status"
      :can-override="session.hasRole('lead')"
      :sequence="flow.sequence.value"
      :next-match-key="departingFor?.match_key ?? null"
      @close="dialogOpen = false"
    />
  </section>
</template>

<style scoped>
.status-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 140px;
  padding: 16px;
  border: none;
  border-radius: 24px;
  font: inherit;
  text-align: center;
  cursor: pointer;
}

.status-text {
  font-size: clamp(1.6rem, 3.2vw, 2.6rem);
  font-weight: 700;
  line-height: 1.15;
}

.since {
  font-size: 1rem;
  font-variant-numeric: tabular-nums;
  opacity: 0.85;
}
</style>
