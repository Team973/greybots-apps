<script setup lang="ts">
import { computed } from 'vue';
import { formatClock } from '@greybots/common/lib/now';
import { formatTime } from '@/lib/schedule/dates';
import { matchCountdown, matchDeadlines, type MatchPrep } from '@/lib/schedule/timing';
import type { ScheduleItem } from '@/lib/schedule/types';

// One line of match timers (issue #80): a labeled countdown, and when to
// start prep and leave for the queue. The countdown runs to queue time
// ("Time to queue:") and, once that has come, to the match's estimated start
// ("Time to match:"). All follow the match's estimated time, so a TBA update
// or a manual override moves them at once.
const props = defineProps<{ match: ScheduleItem | null; prep: MatchPrep; now: number }>();

const deadlines = computed(() => (props.match ? matchDeadlines(props.match, props.prep) : null));
const countdown = computed(() => (deadlines.value ? matchCountdown(deadlines.value, props.now) : null));
const isEstimate = computed(() => !!props.match?.times && !['actual', 'published'].includes(props.match.times.source));

function deadline(at: number) {
  const ms = at - props.now;
  return { at: formatTime(new Date(at).toISOString()), late: ms <= 0 };
}
const queue = computed(() => (deadlines.value ? deadline(deadlines.value.queueAt) : null));
const prepStart = computed(() => (deadlines.value ? deadline(deadlines.value.prepAt) : null));
</script>

<template>
  <p v-if="match && countdown && queue && prepStart" class="next-match">
    <span class="what">
      <strong>{{ match.title }}</strong> {{ isEstimate ? '~' : '' }}{{ formatTime(match.start_at) }}
    </span>
    <span class="timer" :class="countdown.target">
      <span class="timer-label">{{ countdown.label }}:</span>
      <span class="countdown">{{ countdown.ms > 0 ? formatClock(countdown.ms) : 'Now' }}</span>
    </span>
    <span class="deadline" :class="{ late: prepStart.late }">Prep {{ prepStart.late ? 'since' : 'by' }} {{ prepStart.at }}</span>
    <span class="deadline" :class="{ late: queue.late }">Queue {{ queue.late ? 'was' : 'by' }} {{ queue.at }}</span>
  </p>
  <p v-else class="next-match none">No upcoming match</p>
</template>

<style scoped>
.next-match {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: center;
  gap: 4px 16px;
  margin: 0;
}

.timer {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  white-space: nowrap;
}

.timer-label {
  font-weight: 700;
}

.countdown {
  font-size: 1.3em;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.deadline {
  opacity: 0.85;
}

/* Deadline passed: keep it readable on any status color. */
.deadline.late {
  padding: 0 8px;
  border-radius: 999px;
  background: #1a1a1a;
  color: #ffc107;
  font-weight: 700;
  opacity: 1;
}

.none {
  opacity: 0.7;
}
</style>
