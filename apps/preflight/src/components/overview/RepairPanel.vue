<script setup lang="ts">
import { computed } from 'vue';
import { formatClock } from '@greybots/common/lib/now';
import NextMatchLine from './NextMatchLine.vue';
import { prematchIndex, type ChecklistSequence } from '@/lib/checklists/config';
import type { MatchPrep } from '@/lib/schedule/timing';
import type { ScheduleItem } from '@/lib/schedule/types';
import { robotStatusColors, type RobotStatusEntry } from '@/lib/robot-status/robot-status';

// Repair in progress: a compact red strip with how long repairs have taken,
// and the two ways out: back to the checklist repairs interrupted (its
// checked steps are kept) or straight to the pre-match checklist. The repair
// work itself is handed out as tasks below it.
const props = defineProps<{
  entry: RobotStatusEntry;
  sequence: ChecklistSequence;
  elapsedMs: number | null;
  canAct: boolean;
  busy: boolean;
  nextMatch: ScheduleItem | null;
  prep: MatchPrep;
  now: number;
}>();
const emit = defineEmits<{ resume: [index: number]; history: [] }>();

const colors = robotStatusColors.repair;
const fromIndex = computed(() => props.entry.checklist_index);
const fromChecklist = computed(() => (fromIndex.value === null ? null : props.sequence.checklists[fromIndex.value] ?? null));
const prematch = computed(() => {
  const index = prematchIndex(props.sequence);
  return index >= 0 ? { index, checklist: props.sequence.checklists[index] } : null;
});
// No separate "go to pre-match" when repairs interrupted pre-match itself.
const showPrematch = computed(() => !!prematch.value && prematch.value.index !== fromIndex.value);
</script>

<template>
  <section class="hero repair" :style="{ background: colors.bg, color: colors.fg }">
    <div class="hero-text">
      <h2>Repair in progress</h2>
      <p v-if="fromChecklist || entry.note" class="from">
        <template v-if="fromChecklist">Interrupted {{ fromChecklist.name }}</template>
        <template v-if="entry.note"> · {{ entry.note }}</template>
      </p>
      <NextMatchLine class="next" :match="nextMatch" :prep="prep" :now="now" />
    </div>
    <p class="elapsed" title="Time in repair">{{ elapsedMs === null ? '--:--' : formatClock(elapsedMs) }}</p>
    <div v-if="canAct" class="actions">
      <button v-if="fromChecklist" class="hero-action" :disabled="busy" @click="emit('resume', fromIndex!)">Back to {{ fromChecklist.name }}</button>
      <button v-if="showPrematch" class="hero-action" :class="{ secondary: !!fromChecklist }" :disabled="busy" @click="emit('resume', prematch!.index)">
        Go to {{ prematch!.checklist.name }}
      </button>
    </div>
    <button class="history-link" @click="emit('history')">Status history</button>
  </section>
</template>

<style scoped>
.hero {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 24px;
  padding: 16px 20px 28px;
  border-radius: 16px;
  box-sizing: border-box;
}

.hero-text {
  flex: 1 1 220px;
}

.hero-text h2 {
  margin: 0;
  font-size: clamp(1.6rem, 3vw, 2.4rem);
  line-height: 1.1;
}

.from {
  margin: 4px 0 0;
  opacity: 0.9;
}

.next {
  justify-content: flex-start;
  margin-top: 6px;
}

.elapsed {
  margin: 0;
  font-size: clamp(2rem, 4vw, 3rem);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.hero-action {
  min-width: 180px;
  padding: 14px 20px;
  border: none;
  border-radius: 14px;
  background: #ffffff;
  color: #1a1a1a;
  font: inherit;
  font-size: 1.3rem;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
  touch-action: manipulation;
}

.hero-action.secondary {
  background: transparent;
  color: #fff;
  border: 2px solid #fff;
  box-shadow: none;
}

.hero-action:disabled {
  opacity: 0.6;
}

.history-link {
  position: absolute;
  right: 14px;
  bottom: 10px;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  opacity: 0.8;
  font: inherit;
  font-size: 0.85rem;
  text-decoration: underline;
  cursor: pointer;
}
</style>
