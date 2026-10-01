<script setup lang="ts">
import { computed } from 'vue';
import { formatClock } from '@greybots/common/lib/now';
import NextMatchLine from './NextMatchLine.vue';
import ActiveRepairChip from '@/components/repairs/ActiveRepairChip.vue';
import type { Repair } from '@/lib/repairs/repairs';
import type { MatchPrep } from '@/lib/schedule/timing';
import type { ScheduleItem } from '@/lib/schedule/types';
import { robotStatusColors, type EffectiveStatus } from '@/lib/robot-status/robot-status';

// The big, glanceable state banner for Inbound / Robot Ready / Away, with the
// one action that moves the pit to the next state.
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
}>();
const emit = defineEmits<{ arrived: []; departed: []; matchOver: []; history: [] }>();

const colors = computed(() => robotStatusColors[props.effective.status]);
const elapsed = computed(() => (props.elapsedMs === null ? null : formatClock(props.elapsedMs)));

const title = computed(() => {
  const { status, match } = props.effective;
  if (status === 'away') return match ? `Away · ${match.title}` : 'Away';
  if (status === 'ready') return 'Robot Ready';
  return 'Inbound';
});

const subtitle = computed(() => {
  const { status, autoInbound, match } = props.effective;
  if (status === 'inbound') {
    if (autoInbound && match) return `${match.title} ended · ${elapsed.value} ago`;
    return elapsed.value ? `Waiting for the robot · ${elapsed.value}` : 'Waiting for the robot';
  }
  if (status === 'ready') return elapsed.value ? `Ready for ${elapsed.value}` : 'Ready';
  return elapsed.value ? `Left ${elapsed.value} ago` : 'On the field';
});
</script>

<template>
  <section class="hero" :class="effective.status" :style="{ background: colors.bg, color: colors.fg }">
    <div class="hero-text">
      <h2>{{ title }}</h2>
      <p>{{ subtitle }}</p>
      <!-- While the robot is away, the match it left for is the one in play. -->
      <NextMatchLine v-if="effective.status !== 'away'" class="next" :match="nextMatch" :prep="prep" :now="now" />
    </div>
    <ActiveRepairChip :repairs="repairs" />
    <template v-if="canAct">
      <button v-if="effective.status === 'inbound'" class="hero-action" :disabled="busy" @click="emit('arrived')">Robot arrived</button>
      <button v-else-if="effective.status === 'ready'" class="hero-action" :disabled="busy" @click="emit('departed')">Robot departed</button>
      <button v-else-if="effective.status === 'away'" class="hero-action secondary" :disabled="busy" @click="emit('matchOver')">Match over</button>
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
