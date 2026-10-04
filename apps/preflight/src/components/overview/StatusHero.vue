<script setup lang="ts">
import { computed } from 'vue';
import { formatClock } from '@greybots/common/lib/now';
import BumperChip from './BumperChip.vue';
import NextMatchLine from './NextMatchLine.vue';
import InstalledBatteryChip from '@/components/batteries/InstalledBatteryChip.vue';
import ActiveRepairChip from '@/components/repairs/ActiveRepairChip.vue';
import type { Repair } from '@/lib/repairs/repairs';
import type { MatchPrep } from '@/lib/schedule/timing';
import type { ScheduleItem } from '@/lib/schedule/types';
import { robotStatusColors, type EffectiveStatus } from '@/lib/robot-status/robot-status';

// The big, glanceable state banner for Inbound / Robot Ready / Away / At
// practice field / On break / Day ended, with the one action that moves the
// pit to the next state.
const props = defineProps<{
  effective: EffectiveStatus;
  elapsedMs: number | null;
  nextMatch: ScheduleItem | null;
  prep: MatchPrep;
  now: number;
  // Repairs being worked on right now.
  repairs: Repair[];
  canAct: boolean;
  busy: boolean;
  // Offer the practice field side trip (when Ready).
  canPractice: boolean;
  // Offer "End the day".
  canEndDay: boolean;
}>();
const emit = defineEmits<{
  arrived: [];
  departed: [];
  matchOver: [];
  practice: [];
  practiceReturn: [];
  endDay: [];
  startDay: [];
  resume: [];
  history: [];
}>();

// The day is over: nothing is being timed and there's no match to chase.
const dayEnded = computed(() => props.effective.status === 'day_ended');

const colors = computed(() => robotStatusColors[props.effective.status]);
const elapsed = computed(() => (props.elapsedMs === null ? null : formatClock(props.elapsedMs)));

const title = computed(() => {
  const { status, match } = props.effective;
  if (status === 'away') return match ? `Away · ${match.title}` : 'Away';
  if (status === 'ready') return 'Robot Ready';
  if (status === 'practice') return 'At practice field';
  if (status === 'break') return 'On break';
  if (status === 'day_ended') return 'Day ended';
  return 'Inbound';
});

const subtitle = computed(() => {
  const { status, autoInbound, match } = props.effective;
  if (status === 'inbound') {
    if (autoInbound && match) return `${match.title} ended · ${elapsed.value} ago`;
    return elapsed.value ? `Waiting for the robot · ${elapsed.value}` : 'Waiting for the robot';
  }
  if (status === 'ready') return elapsed.value ? `Ready for ${elapsed.value}` : 'Ready';
  if (status === 'practice') return elapsed.value ? `Left ${elapsed.value} ago · pre-match when it's back` : 'Pre-match when it returns';
  if (status === 'break') {
    const from = props.effective.entry?.pending_label;
    return [from ? `Paused ${from}` : 'Paused', elapsed.value].filter(Boolean).join(' · ');
  }
  // No timer: the point of ending the day is that nothing runs overnight.
  if (status === 'day_ended') return 'The pit is closed. Start the day to run the start of day checklist.';
  return elapsed.value ? `Left ${elapsed.value} ago` : 'On the field';
});
</script>

<template>
  <section class="hero" :class="effective.status" :style="{ background: colors.bg, color: colors.fg }">
    <div class="hero-text">
      <h2>{{ title }}</h2>
      <p>{{ subtitle }}</p>
      <!-- While the robot is away, the match it left for is the one in play. -->
      <NextMatchLine v-if="effective.status !== 'away' && !dayEnded" class="next" :match="nextMatch" :prep="prep" :now="now" />
    </div>
    <div v-if="!dayEnded" class="chips">
      <InstalledBatteryChip />
      <BumperChip :match="nextMatch" />
      <ActiveRepairChip :repairs="repairs" />
    </div>
    <template v-if="canAct">
      <button v-if="effective.status === 'inbound'" class="hero-action" :disabled="busy" @click="emit('arrived')">Robot arrived</button>
      <div v-else-if="effective.status === 'ready'" class="hero-actions">
        <button class="hero-action" :disabled="busy" @click="emit('departed')">Robot departed</button>
        <button v-if="canPractice" class="hero-action outline" :disabled="busy" @click="emit('practice')">Practice field</button>
      </div>
      <button v-else-if="effective.status === 'practice'" class="hero-action" :disabled="busy" @click="emit('practiceReturn')">Back from practice field</button>
      <button v-else-if="effective.status === 'away'" class="hero-action secondary" :disabled="busy" @click="emit('matchOver')">Match over</button>
      <button v-else-if="effective.status === 'break'" class="hero-action" :disabled="busy" @click="emit('resume')">Back to work</button>
      <button v-else-if="dayEnded" class="hero-action" :disabled="busy" @click="emit('startDay')">Start day</button>
      <button v-if="canEndDay" class="corner-link end-day" :disabled="busy" @click="emit('endDay')">End the day</button>
    </template>
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
  gap: 16px;
  min-height: 0;
  padding: 24px 20px 40px;
  border-radius: 16px;
  text-align: center;
  box-sizing: border-box;
}

.hero-text h2 {
  margin: 0;
  font-size: clamp(2rem, 4.5vw, 3.4rem);
  line-height: 1.1;
}

.hero-text p {
  margin: 6px 0 0;
  font-size: clamp(1rem, 1.8vw, 1.3rem);
  opacity: 0.9;
}

.hero-text .next {
  margin-top: 10px;
  font-size: clamp(0.95rem, 1.5vw, 1.15rem);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  max-width: 100%;
}

.hero-action {
  min-width: min(320px, 90%);
  padding: 22px 32px;
  border: none;
  border-radius: 16px;
  background: #ffffff;
  color: #1a1a1a;
  font: inherit;
  font-size: clamp(1.4rem, 2.6vw, 2rem);
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
  touch-action: manipulation;
}

/* Two equally big choices side by side (Robot Ready). */
.hero-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  width: 100%;
}

.hero-actions .hero-action {
  min-width: min(280px, 90%);
}

.hero-action.outline {
  border: 3px solid #ffffff;
  background: transparent;
  color: #ffffff;
  box-shadow: none;
}

.hero-action:active {
  transform: scale(0.98);
}

.hero-action:disabled {
  opacity: 0.6;
}

.hero-action.secondary {
  padding: 14px 24px;
  font-size: 1.2rem;
}

.corner-link {
  position: absolute;
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

.end-day {
  left: 14px;
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
