<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import DurationHistogram from '@/components/stats/DurationHistogram.vue';
import StatTile from '@/components/stats/StatTile.vue';
import TurnaroundBars from '@/components/stats/TurnaroundBars.vue';
import { listAllChecks, type ChecklistCheck } from '@/lib/checklists/checks';
import { getChecklistSequence, type ChecklistSequence } from '@/lib/checklists/config';
import { useLiveQuery } from '@/lib/live-query';
import { listStatusHistory, type RobotStatusEntry } from '@/lib/robot-status/robot-status';
import { getActiveEvent, listScheduleItems } from '@/lib/schedule/schedule-repo';
import type { ActiveEvent, ScheduleItem } from '@/lib/schedule/types';
import { buildPitStats, formatDuration, mean, median } from '@/lib/stats/pit-stats';

// Stats: how long the pit takes, and where the time goes. Headline numbers
// first, then what stands out, then the detail (every turnaround as a stacked
// bar, how the times are spread, and the slowest steps). Everything is worked
// out from the robot status log and the checked steps of the active event.
const activeEvent = useLiveQuery<ActiveEvent | null>(getActiveEvent, null);
const eventKey = computed(() => activeEvent.value?.event_key ?? '');
const items = useLiveQuery<ScheduleItem[]>(() => (eventKey.value ? listScheduleItems(eventKey.value) : []), [], eventKey);
const history = useLiveQuery<RobotStatusEntry[]>(() => (eventKey.value ? listStatusHistory(eventKey.value) : []), [], eventKey);
const checks = useLiveQuery<ChecklistCheck[]>(() => (eventKey.value ? listAllChecks(eventKey.value) : []), [], eventKey);
const sequence = useLiveQuery<ChecklistSequence>(getChecklistSequence, { checklists: [] });

const stats = computed(() => buildPitStats(history.value, checks.value, sequence.value, items.value));
const turnarounds = computed(() => stats.value.turnarounds);
const count = computed(() => turnarounds.value.length);

const totals = computed(() => turnarounds.value.map((t) => t.total));
const withoutRepairs = computed(() => turnarounds.value.map((t) => t.withoutRepairs));
const repaired = computed(() => turnarounds.value.filter((t) => t.repair > 0));
const practice = computed(() => stats.value.practicePrep.map((s) => s.ms));

const time = (values: number[], pick: (v: number[]) => number = mean) => (values.length ? formatDuration(pick(values)) : '—');
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The few steps that take longest on average, with enough runs to mean something.
const slowSteps = computed(() => stats.value.steps.filter((s) => mean(s.samples) > 0).slice(0, 8));
const slowestStep = computed(() => Math.max(1, ...slowSteps.value.map((s) => mean(s.samples))));

// --- What stands out ---
const insights = computed(() => {
  const list: string[] = [];
  if (!count.value) return list;

  const sum = (key: 'post' | 'repair' | 'pre') => turnarounds.value.reduce((total, t) => total + t[key], 0);
  const all = sum('post') + sum('repair') + sum('pre');
  if (all > 0) {
    const stages = [
      { name: 'Post-match', ms: sum('post') },
      { name: 'Repairs', ms: sum('repair') },
      { name: 'Pre-match', ms: sum('pre') }
    ].sort((a, b) => b.ms - a.ms);
    list.push(`${stages[0].name} takes the most pit time: ${Math.round((stages[0].ms / all) * 100)}% of all turnaround time.`);
  }

  if (repaired.value.length) {
    const added = mean(repaired.value.map((t) => t.repair));
    list.push(
      `Repairs happened in ${repaired.value.length} of ${plural(count.value, 'turnaround')} and added ${formatDuration(added)} each time on average.`
    );
  } else {
    list.push(`No repairs in ${plural(count.value, 'turnaround')}.`);
  }

  const step = slowSteps.value[0];
  if (step) list.push(`The slowest step is “${step.step}” (${step.checklist}): ${formatDuration(mean(step.samples))} on average.`);

  if (count.value >= 3) {
    const worst = [...turnarounds.value].sort((a, b) => b.total - a.total)[0];
    const typical = median(totals.value);
    if (worst.total > typical * 1.5) {
      const where = worst.matchTitle ? `before ${worst.matchTitle}` : 'of the event';
      list.push(`The longest turnaround (${where}) took ${formatDuration(worst.total)}, against a typical ${formatDuration(typical)}.`);
    }
  }
  return list;
});
</script>

<template>
  <div v-if="!activeEvent" class="card">
    <h2>No event set up</h2>
    <p class="hint">Stats are worked out per event.</p>
    <RouterLink to="/schedule" class="panel-link">Set up the event on the Schedule page →</RouterLink>
  </div>

  <div v-else class="stats-view">
    <header class="page-header">
      <h1>Stats</h1>
      <p class="hint">
        {{ activeEvent.name }}. A turnaround runs from the robot coming into the pit to it being ready. Practice field time and time
        sitting ready are never counted.
      </p>
    </header>

    <p v-if="!count" class="hint empty">
      No completed turnarounds yet. They appear here once the robot has gone from “Robot arrived” to Robot Ready on the Overview.
    </p>

    <template v-else>
      <section class="tiles" aria-label="Match turnaround">
        <StatTile
          label="Average turnaround, with repairs"
          :value="time(totals)"
          :detail="`Median ${time(totals, median)} · ${plural(count, 'turnaround')}`"
        />
        <StatTile label="Average turnaround, without repairs" :value="time(withoutRepairs)" :detail="`Median ${time(withoutRepairs, median)}`" />
        <StatTile
          label="Average repair time, when there is one"
          :value="time(repaired.map((t) => t.repair))"
          :detail="`${repaired.length} of ${plural(count, 'turnaround')} had repairs`"
        />
        <StatTile
          label="Practice field prep, average"
          :value="time(practice)"
          :detail="practice.length ? `Median ${time(practice, median)} · ${plural(practice.length, 'trip')}` : 'No practice field trips yet'"
        />
      </section>

      <section class="tiles" aria-label="Time to complete each checklist">
        <StatTile
          v-for="checklist in stats.checklists"
          :key="checklist.name"
          :label="`${checklist.name}, average (repairs not counted)`"
          :value="time(checklist.samples.map((s) => s.ms))"
          :detail="
            checklist.samples.length
              ? `Median ${time(checklist.samples.map((s) => s.ms), median)} · ${plural(checklist.samples.length, 'run')}`
              : 'Not completed yet'
          "
        />
      </section>

      <section v-if="insights.length" class="panel insights">
        <h2>What stands out</h2>
        <ul>
          <li v-for="line in insights" :key="line">{{ line }}</li>
        </ul>
      </section>

      <TurnaroundBars :turnarounds="turnarounds" />

      <section class="charts" aria-label="How the times are spread">
        <DurationHistogram title="Turnaround, with repairs" :values="totals" unit="turnaround" />
        <DurationHistogram title="Turnaround, without repairs" :values="withoutRepairs" unit="turnaround" />
        <DurationHistogram
          v-for="checklist in stats.checklists"
          :key="checklist.name"
          :title="`${checklist.name} checklist`"
          :values="checklist.samples.map((s) => s.ms)"
        />
        <DurationHistogram title="Practice field prep" :values="practice" unit="trip" />
      </section>

      <section v-if="slowSteps.length" class="panel viz-root">
        <h2>Slowest steps</h2>
        <p class="hint">Average time from the step before it, counting only time spent on that checklist (not repairs).</p>
        <ol class="steps">
          <li v-for="step in slowSteps" :key="`${step.checklist}:${step.step}`">
            <span class="step-name">
              {{ step.step }} <span class="step-checklist">{{ step.checklist }}</span>
            </span>
            <span class="step-track">
              <span class="step-bar" :style="{ width: `${(mean(step.samples) / slowestStep) * 100}%` }"></span>
              <span class="step-value">{{ formatDuration(mean(step.samples)) }} <span class="step-n">· {{ plural(step.samples.length, 'time') }}</span></span>
            </span>
          </li>
        </ol>
      </section>
    </template>
  </div>
</template>

<style scoped>
.stats-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 1300px;
}

.page-header h1 {
  margin: 0;
  font-size: 1.8rem;
}

.hint {
  margin: 4px 0 0;
  opacity: 0.7;
  font-size: 0.9rem;
}

.empty {
  padding: 24px 0;
}

.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 12px;
}

.charts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 12px;
}

.panel h2 {
  margin: 0;
  font-size: 1.1rem;
}

.insights ul {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding-left: 1.2em;
  font-size: 1.05rem;
}

.steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.steps li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  align-items: center;
  gap: 12px;
}

.step-name {
  overflow-wrap: anywhere;
}

.step-checklist,
.step-n {
  font-size: 0.8rem;
  opacity: 0.7;
}

.step-track {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.step-bar {
  flex: none;
  height: 14px;
  min-width: 2px;
  max-width: calc(100% - 9em);
  border-radius: 0 4px 4px 0;
  background: var(--viz-series-1);
}

.step-value {
  flex: none;
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

@media (max-width: 700px) {
  .steps li {
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
  }
}
</style>
