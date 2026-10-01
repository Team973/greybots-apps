<script setup lang="ts">
import { computed, ref } from 'vue';
import RobotStatusDialog from './RobotStatusDialog.vue';
import { useLiveQuery } from '@/lib/live-query';
import { formatElapsed, useNow } from '@/lib/now';
import { listStatusHistory, robotStatusColors, statusText, type RobotStatusEntry } from '@/lib/robot-status/robot-status';
import { useSessionStore } from '@/stores/session-store';

// Big, color-coded robot readiness indicator. Reusable on the pit display.
const props = defineProps<{ eventKey: string }>();
const session = useSessionStore();
const canEdit = computed(() => session.hasRole('lead'));
const now = useNow(30_000);

const eventKey = computed(() => props.eventKey);
// Null until the first load, so the card doesn't flash the "In Pit" default
// before the real status arrives.
const history = useLiveQuery<RobotStatusEntry[] | null>(() => listStatusHistory(eventKey.value), null, eventKey);
const loaded = computed(() => history.value !== null);
const current = computed(() => history.value?.[0] ?? null);
const colors = computed(() => (loaded.value ? robotStatusColors[current.value?.status ?? 'in_pit'] : { bg: 'var(--accent-color)', fg: 'inherit' }));
const dialogOpen = ref(false);
</script>

<template>
  <section class="panel status-panel">
    <header class="panel-header"><h2>Robot Status</h2></header>
    <button
      class="status-card"
      :style="{ background: colors.bg, color: colors.fg }"
      :aria-label="`Robot status: ${statusText(current)}. ${canEdit ? 'Change status' : 'Show history'}`"
      @click="dialogOpen = true"
    >
      <span class="status-text">{{ loaded ? statusText(current) : '…' }}</span>
      <span v-if="current" class="since">
        {{ formatElapsed(now - Date.parse(current.set_at)) }} ago<template v-if="current.set_by_name"> · {{ current.set_by_name }}</template>
      </span>
      <span v-if="current?.note" class="since">{{ current.note }}</span>
    </button>
    <RobotStatusDialog :open="dialogOpen" :event-key="eventKey" :history="history ?? []" :can-edit="canEdit" @close="dialogOpen = false" />
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
  font-size: 0.9rem;
  opacity: 0.85;
}
</style>
