<script setup lang="ts">
import { computed } from 'vue';
import { formatClock } from '@greybots/common/lib/now';
import { prematchIndex, type ChecklistSequence } from '@/lib/checklists/config';
import { robotStatusColors, type RobotStatusEntry } from '@/lib/robot-status/robot-status';

// Repair in progress: a red banner with how long repairs have taken, and the
// two ways out: back to the checklist repairs interrupted (its checked steps
// are kept) or straight to the pre-match checklist.
const props = defineProps<{
  entry: RobotStatusEntry;
  sequence: ChecklistSequence;
  elapsedMs: number | null;
  canAct: boolean;
  busy: boolean;
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
      <p class="elapsed">{{ elapsedMs === null ? '--:--' : formatClock(elapsedMs) }}</p>
      <p v-if="entry.note" class="note">{{ entry.note }}</p>
      <p v-if="fromChecklist" class="from">Interrupted {{ fromChecklist.name }}</p>
    </div>
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
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  min-height: 0;
  padding: 24px 20px 40px;
  border-radius: 16px;
  text-align: center;
  box-sizing: border-box;
}

.hero-text h2 {
  margin: 0;
  font-size: clamp(2rem, 4.5vw, 3.2rem);
  line-height: 1.1;
}

.elapsed {
  margin: 6px 0 0;
  font-size: clamp(2.2rem, 5vw, 3.6rem);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.note {
  margin: 10px 0 0;
  font-size: 1.2rem;
  font-weight: 600;
}

.from {
  margin: 6px 0 0;
  opacity: 0.85;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
}

.hero-action {
  min-width: 220px;
  padding: 18px 24px;
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
