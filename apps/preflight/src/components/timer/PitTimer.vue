<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useLiveQuery } from '@/lib/live-query';
import {
  adjustTimerDigit,
  defaultTimerState,
  getPitTimer,
  pauseTimer,
  resetTimer,
  startTimer,
  timerPhase,
  timerRemainingMs,
  type TimerState
} from '@/lib/timer/timer';
import { useSessionStore } from '@/stores/session-store';

// The pit timer: four digits (up to 99:99), each with its own + and −, then
// Start. While it counts down, Start becomes Pause and Reset; Pause becomes
// Play; Reset goes back to the time that was dialed in. Every copy of this
// component reads the same synced row (lib/timer), so the Overview and the
// pit display always show the same timer.
const props = withDefaults(
  defineProps<{
    // Show the time only (e.g. for an observer on the pit display).
    readonly?: boolean;
    // 'display' sizes everything in em, to scale with a pit display widget.
    variant?: 'panel' | 'display';
  }>(),
  { readonly: false, variant: 'panel' }
);
const session = useSessionStore();
const editor = () => session.user?.name ?? null;

const timer = useLiveQuery<TimerState>(getPitTimer, defaultTimerState);
const phase = computed(() => timerPhase(timer.value));

// Real time, not the app clock: see lib/timer.
const now = ref(Date.now());
const tick = setInterval(() => (now.value = Date.now()), 250);
onBeforeUnmount(() => clearInterval(tick));

const remainingMs = computed(() => timerRemainingMs(timer.value, now.value));
const finished = computed(() => phase.value === 'running' && remainingMs.value === 0);

// Stopped: the digits exactly as dialed in (so 99:99 reads 99:99). Counting
// down: minutes and seconds left.
const digits = computed(() => {
  if (phase.value === 'stopped') return timer.value.set_digits.split('');
  const total = Math.ceil(remainingMs.value / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 60))}${pad(total % 60)}`.split('');
});
// Minutes can need a third digit while running (99:99 is 100:39).
const minutes = computed(() => digits.value.slice(0, -2));
const seconds = computed(() => digits.value.slice(-2));
const canAdjust = computed(() => !props.readonly && phase.value === 'stopped');
const digitNames = ['tens of minutes', 'minutes', 'tens of seconds', 'seconds'];

const error = ref<string | null>(null);
async function act(action: () => Promise<unknown>) {
  error.value = null;
  try {
    await action();
    now.value = Date.now();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}
const adjust = (index: number, delta: 1 | -1) => act(() => adjustTimerDigit(timer.value, index, delta, editor()));
const start = () => act(() => startTimer(timer.value, editor()));
const pause = () => act(() => pauseTimer(timer.value, editor()));
const reset = () => act(() => resetTimer(timer.value, editor()));
</script>

<template>
  <div class="pit-timer" :class="[variant, phase, { finished }]">
    <div class="face" role="timer" :aria-label="`${minutes.join('')} minutes ${seconds.join('')} seconds`">
      <template v-for="(group, g) in [minutes, seconds]" :key="g">
        <span v-if="g === 1" class="colon" aria-hidden="true">:</span>
        <span v-for="(digit, i) in group" :key="`${g}-${i}`" class="digit">
          <button v-if="canAdjust" class="step" :aria-label="`Increase ${digitNames[g * 2 + i]}`" @click="adjust(g * 2 + i, 1)">+</button>
          <span class="value">{{ digit }}</span>
          <button v-if="canAdjust" class="step" :aria-label="`Decrease ${digitNames[g * 2 + i]}`" @click="adjust(g * 2 + i, -1)">−</button>
        </span>
      </template>
    </div>
    <div v-if="!readonly" class="controls">
      <button v-if="phase === 'stopped'" class="control go" :disabled="remainingMs === 0" @click="start">Start</button>
      <template v-else>
        <button v-if="phase === 'running' && !finished" class="control pause" @click="pause">Pause</button>
        <button v-else-if="phase === 'paused'" class="control go" @click="start">Play</button>
        <button class="control" @click="reset">Reset</button>
      </template>
    </div>
    <p v-if="error" class="error-text">{{ error }}</p>
  </div>
</template>

<style scoped>
.pit-timer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.4em 1.2em;
  /* The digits' size; everything else follows it. */
  font-size: clamp(2rem, 3.4vw, 2.8rem);
}

.pit-timer.display {
  font-size: 2.6em;
}

.face {
  display: flex;
  align-items: center;
  gap: 0.08em;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.digit {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.08em;
}

.value {
  min-width: 0.62em;
  text-align: center;
}

.colon {
  padding: 0 0.04em;
}

.step {
  width: 2.1em;
  height: 1.5em;
  padding: 0;
  border: 1px solid currentColor;
  border-radius: 0.4em;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.4em;
  font-weight: 600;
  line-height: 1;
  opacity: 0.8;
  cursor: pointer;
  touch-action: manipulation;
}

.step:hover {
  opacity: 1;
}

.paused .face {
  opacity: 0.6;
}

.finished .face {
  color: #e5534b;
  animation: blink 1s steps(2, start) infinite;
}

@keyframes blink {
  to {
    visibility: hidden;
  }
}

.controls {
  display: flex;
  gap: 0.5em;
  font-size: 0.4em;
}

.control {
  min-width: 5em;
  padding: 0.6em 1em;
  border: 1px solid currentColor;
  border-radius: 0.5em;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  touch-action: manipulation;
}

.control:disabled {
  opacity: 0.4;
  cursor: default;
}

.control.go {
  border-color: #2e7d32;
  background: #2e7d32;
  color: #fff;
}

.control.pause {
  border-color: #b8860b;
  background: #b8860b;
  color: #fff;
}

.error-text {
  flex-basis: 100%;
  font-size: 0.85rem;
  text-align: center;
}
</style>
