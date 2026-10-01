<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { useNow } from '../lib/now';

// Countdown timer with +/− buttons per digit of MM:SS, Start/Pause, and
// Reset. Optionally it can count down to an app-supplied target time (e.g.
// the team's next match). Its state is per device and kept in localStorage
// under `storageKey`, so it survives page switches and reloads.
const props = withDefaults(
  defineProps<{
    // What the target button counts down to; null when nothing is upcoming.
    target?: { label: string; at: string | number } | null;
    // Label for the target button. The button is hidden when this is unset.
    targetButtonLabel?: string;
    storageKey?: string;
  }>(),
  { target: null, targetButtonLabel: undefined, storageKey: 'countdown_timer' }
);

interface TimerState {
  // The value dialed in with the +/− buttons.
  setMs: number;
  // While running: when it reaches zero. Null when stopped or paused.
  endsAt: number | null;
  // While paused: time left. Null otherwise.
  pausedMs: number | null;
  // What it's counting to, e.g. "Qual 12".
  label: string | null;
}

const maxSetMs = (99 * 60 + 59) * 1000;

function load(): TimerState {
  try {
    const saved = JSON.parse(localStorage.getItem(props.storageKey) ?? 'null');
    if (saved && typeof saved.setMs === 'number') return saved;
  } catch {
    // Unreadable storage; start fresh.
  }
  return { setMs: 5 * 60_000, endsAt: null, pausedMs: null, label: null };
}

const state = reactive<TimerState>(load());
watch(state, (value) => {
  try {
    localStorage.setItem(props.storageKey, JSON.stringify(value));
  } catch {
    // Storage unavailable; the timer just won't persist.
  }
});

const now = useNow(250);
const running = computed(() => state.endsAt !== null);
const remainingMs = computed(() => {
  if (state.endsAt !== null) return Math.max(0, state.endsAt - now.value);
  return state.pausedMs ?? state.setMs;
});
const finished = computed(() => running.value && remainingMs.value === 0);

// MM:SS, or H:MM:SS when counting to something more than 100 minutes out.
const display = computed(() => {
  const total = Math.ceil(remainingMs.value / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return total >= 6000 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(Math.floor(total / 60))}:${pad(s)}`;
});

// One +/− pair per digit of MM:SS.
const digitSteps = [600_000, 60_000, 10_000, 1_000];
const canAdjust = computed(() => !running.value);

function adjust(stepMs: number, direction: 1 | -1) {
  const base = state.pausedMs ?? state.setMs;
  state.setMs = Math.min(maxSetMs, Math.max(0, base + direction * stepMs));
  state.pausedMs = null;
  state.label = null;
}

function startPause() {
  // The ticking clock can be up to one tick stale; refresh it so the display
  // doesn't jump up a second on start or pause.
  now.value = Date.now();
  if (running.value) {
    state.pausedMs = remainingMs.value;
    state.endsAt = null;
  } else if (remainingMs.value > 0) {
    state.endsAt = Date.now() + remainingMs.value;
    state.pausedMs = null;
  }
}

function reset() {
  state.endsAt = null;
  state.pausedMs = null;
  state.label = null;
}

function countToTarget() {
  if (!props.target) return;
  state.endsAt = typeof props.target.at === 'number' ? props.target.at : Date.parse(props.target.at);
  state.pausedMs = null;
  state.label = props.target.label;
}
</script>

<template>
  <section class="countdown-timer" :class="{ finished }">
    <div class="digit-buttons">
      <button v-for="(step, i) in digitSteps" :key="`up${i}`" :disabled="!canAdjust" :aria-label="`Add ${step / 1000} seconds`" @click="adjust(step, 1)">+</button>
    </div>
    <div class="display" role="timer" aria-live="off">{{ display }}</div>
    <div class="digit-buttons">
      <button v-for="(step, i) in digitSteps" :key="`down${i}`" :disabled="!canAdjust" :aria-label="`Subtract ${step / 1000} seconds`" @click="adjust(step, -1)">−</button>
    </div>
    <p class="label">{{ state.label ? `until ${state.label}` : ' ' }}</p>
    <div class="controls">
      <button class="start" :class="{ pause: running }" @click="startPause">{{ running ? 'Pause' : 'Start' }}</button>
      <button @click="reset">Reset</button>
      <button
        v-if="targetButtonLabel"
        :disabled="!target"
        :title="target ? `Count down to ${target.label}` : 'Nothing upcoming'"
        @click="countToTarget"
      >
        {{ targetButtonLabel }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.countdown-timer {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.digit-buttons {
  display: grid;
  grid-template-columns: repeat(2, 44px) 12px repeat(2, 44px);
  gap: 6px;
}

/* Leave a gap in the button rows where the colon sits. */
.digit-buttons button:nth-child(3) {
  grid-column: 4;
}

.digit-buttons button {
  height: 36px;
  border: 1px solid var(--accent-color);
  border-radius: 8px;
  background: var(--background-color);
  color: var(--primary-text-color);
  font-size: 1.2rem;
  cursor: pointer;
  touch-action: manipulation;
}

.digit-buttons button:disabled {
  opacity: 0.35;
  cursor: default;
}

.display {
  font-size: clamp(2.8rem, 6vw, 4.4rem);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.finished .display {
  color: #e5534b;
  animation: blink 1s steps(2, start) infinite;
}

@keyframes blink {
  to { visibility: hidden; }
}

.label {
  margin: 0;
  font-size: 0.85rem;
  opacity: 0.75;
}

.controls {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 4px;
}

.controls button {
  padding: 8px 14px;
  border: 1px solid var(--accent-color);
  border-radius: 8px;
  background: transparent;
  color: var(--primary-text-color);
  font: inherit;
  cursor: pointer;
}

.controls button:disabled {
  opacity: 0.4;
  cursor: default;
}

.controls .start {
  min-width: 96px;
  border-color: #2e7d32;
  background: #2e7d32;
  color: #fff;
  font-weight: 600;
}

.controls .start.pause {
  border-color: #b8860b;
  background: #b8860b;
}
</style>
