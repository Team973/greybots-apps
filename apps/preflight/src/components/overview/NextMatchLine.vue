<script setup lang="ts">
import { computed } from 'vue';
import { formatClock } from '@greybots/common/lib/now';
import { formatTime } from '@/lib/schedule/dates';
import { matchDeadlines, type MatchPrep } from '@/lib/schedule/timing';
import type { ScheduleItem } from '@/lib/schedule/types';

// One line of match timers (issue #80): the countdown to the next match, and
// when to start prep and leave for the queue. All follow the match's
// estimated time, so a TBA update or a manual override moves them at once.
const props = defineProps<{ match: ScheduleItem | null; prep: MatchPrep; now: number }>();

const deadlines = computed(() => (props.match ? matchDeadlines(props.match, props.prep) : null));
const untilStart = computed(() => (deadlines.value ? deadlines.value.start - props.now : 0));
const isEstimate = computed(() => !!props.match?.times && !['actual', 'published'].includes(props.match.times.source));

function deadline(at: number) {
  const ms = at - props.now;
  return { at: formatTime(new Date(at).toISOString()), late: ms <= 0, minutes: Math.ceil(Math.abs(ms) / 60_000) };
}
const queue = computed(() => (deadlines.value ? deadline(deadlines.value.queueAt) : null));
const prepStart = computed(() => (deadlines.value ? deadline(deadlines.value.prepAt) : null));
</script>

<template>
  <p v-if="match && deadlines && queue && prepStart" class="next-match">
    <span class="what">
      <strong>{{ match.title }}</strong> {{ isEstimate ? '~' : '' }}{{ formatTime(match.start_at) }}
    </span>
    <span v-if="untilStart > 0" class="countdown" title="Time until the match starts">{{ formatClock(untilStart) }}</span>
    <span v-else class="countdown">Now</span>
    <span class="deadline" :class="{ late: prepStart.late }">Prep {{ prepStart.late ? 'since' : 'by' }} {{ prepStart.at }}</span>
    <span class="deadline" :class="{ late: queue.late }">
      Queue {{ queue.late ? `was ${queue.at}` : `by ${queue.at} (${queue.minutes}m)` }}
    </span>
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
