<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { formatClock, formatElapsed } from '@greybots/common/lib/now';
import { formatReading } from '@/lib/batteries/batteries';
import { useBatteries } from '@/lib/batteries/use-batteries';
import { listChecks, type ChecklistCheck } from '@/lib/checklists/checks';
import { sequenceMatchLink } from '@/lib/checklists/config';
import { instanceTitle, matchContext, resolveMatchLink } from '@/lib/checklists/instances';
import { listChecklistRuns, type ChecklistRun } from '@/lib/checklists/runs';
import { activeStepIndex } from '@/lib/checklists/smart';
import { activeLayout, defaultDisplayConfig, getDisplayConfig, type DisplayConfig } from '@/lib/display/display';
import { useLiveQuery } from '@/lib/live-query';
import { activeRepairs, listRepairs, type Repair } from '@/lib/repairs/repairs';
import { isPracticeChecklist, robotStatusColors } from '@/lib/robot-status/robot-status';
import { useRobotFlow } from '@/lib/robot-status/use-robot-flow';
import { formatTime } from '@/lib/schedule/dates';
import { currentPhase, milestoneState, sortMilestones } from '@/lib/schedule/milestones';
import { getActiveEvent, listScheduleItems } from '@/lib/schedule/schedule-repo';
import { defaultMatchPrep, getMatchPrep, matchCountdown, matchDeadlines, type MatchPrep } from '@/lib/schedule/timing';
import { matchColor, phaseLabels, type ActiveEvent, type ScheduleItem } from '@/lib/schedule/types';
import { useSyncStore } from '@/stores/sync-store';

// The pit display (issue #90): a full-screen, read-only summary meant to be
// read from across the pit on a TV. The robot status fills the top; below it
// are the widgets configured for the current event phase (Pit setup).
// Everything comes from the local database, so it keeps running through
// reloads and network drops, and it never auto-locks (see App.vue).
const sync = useSyncStore();

const activeEvent = useLiveQuery<ActiveEvent | null>(getActiveEvent, null);
const eventKey = computed(() => activeEvent.value?.event_key ?? '');
const items = useLiveQuery<ScheduleItem[]>(() => (eventKey.value ? listScheduleItems(eventKey.value) : []), [], eventKey);
const matches = computed(() =>
  items.value.filter((i) => i.kind === 'match').sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
);

const flow = useRobotFlow(eventKey, matches);
const now = flow.now;
const status = computed(() => flow.effective.value.status);
const colors = computed(() => robotStatusColors[status.value]);

// --- Layout for the current phase ---
const config = useLiveQuery<DisplayConfig>(getDisplayConfig, defaultDisplayConfig());
const phase = computed(() => currentPhase(items.value, now.value));
const layout = computed(() => activeLayout(config.value, phase.value));
// Rows of widgets under the status (three across, two for 2 or 4 widgets).
// More rows means less height each, so the type scales down with it.
const widgetRows = computed(() => {
  const count = layout.value.widgets.length;
  return Math.max(1, Math.ceil(count / (count === 2 || count === 4 ? 2 : 3)));
});

// --- Checklist in progress ---
const sequence = flow.sequence;
const checklistIndex = computed(() => flow.latest.value?.checklist_index ?? 0);
const onPractice = computed(() => isPracticeChecklist(flow.latest.value));
const pitChecklist = computed(() => {
  if (status.value !== 'pending') return null;
  return onPractice.value ? flow.practice.value : sequence.value.checklists[checklistIndex.value] ?? null;
});
const pitLink = computed(() =>
  onPractice.value
    ? { label: null, matchKey: null }
    : resolveMatchLink(sequenceMatchLink(sequence.value, checklistIndex.value), matchContext(matches.value, now.value))
);
const runId = computed(() => (status.value === 'pending' ? flow.latest.value?.run_id ?? '' : ''));
const pitChecks = useLiveQuery<ChecklistCheck[]>(() => (runId.value ? listChecks(eventKey.value, runId.value) : []), [], runId);
const pitProgress = computed(() => {
  const list = pitChecklist.value;
  if (!list) return null;
  const index = activeStepIndex(pitChecks.value, list, { matches: matches.value, now: now.value });
  return { done: index, total: list.steps.length, step: list.steps[index]?.title ?? null };
});
// Ad-hoc checklists still open (e.g. start of day).
const runs = useLiveQuery<ChecklistRun[]>(() => (eventKey.value ? listChecklistRuns(eventKey.value) : []), [], eventKey);
const openRuns = computed(() => runs.value.filter((r) => !r.completed_at));

// --- The big status line ---
const headline = computed(() => {
  const { match } = flow.effective.value;
  switch (status.value) {
    case 'pending':
      return pitChecklist.value ? `Pending ${pitChecklist.value.name}` : `Pending ${flow.latest.value?.pending_label ?? ''}`.trim();
    case 'repair':
      return 'Repair in progress';
    case 'ready':
      return 'Robot Ready';
    case 'practice':
      return 'At practice field';
    case 'away':
      return match ? `Away · ${match.title}` : 'Away';
    default:
      return 'Inbound';
  }
});
const elapsed = computed(() => (flow.elapsedMs.value === null ? null : formatClock(flow.elapsedMs.value)));

// --- Matches ---
const nextMatch = computed(() => matches.value.find((m) => Date.parse(m.start_at) > now.value) ?? null);
// The match being played: the one the robot left for, else one under way.
const currentMatch = computed(() => {
  if (status.value === 'away' && flow.effective.value.match) return flow.effective.value.match;
  return matches.value.find((m) => Date.parse(m.start_at) <= now.value && now.value < Date.parse(m.end_at)) ?? null;
});
const prep = useLiveQuery<MatchPrep>(getMatchPrep, defaultMatchPrep);
const deadlines = computed(() => (nextMatch.value ? matchDeadlines(nextMatch.value, prep.value) : null));
// Counts down to queue time, then to the match.
const countdown = computed(() => (deadlines.value ? matchCountdown(deadlines.value, now.value) : null));
function deadline(at: number) {
  const ms = at - now.value;
  return { at: formatTime(new Date(at).toISOString()), late: ms <= 0, text: ms <= 0 ? `${formatElapsed(-ms)} ago` : `in ${formatElapsed(ms)}` };
}
const isEstimate = (m: ScheduleItem) => !!m.times && !['actual', 'published'].includes(m.times.source);
const allianceName = (m: ScheduleItem) => (m.match_info?.alliance === 'red' ? 'Red' : m.match_info?.alliance === 'blue' ? 'Blue' : null);
function partners(m: ScheduleItem): string {
  const info = m.match_info;
  if (!info?.alliance) return '';
  return info[info.alliance].join(' · ');
}

// --- Repairs, battery, roles, phase ---
const repairs = useLiveQuery<Repair[]>(() => (eventKey.value ? listRepairs(eventKey.value) : []), [], eventKey);
const repairsInProgress = computed(() => activeRepairs(repairs.value));
const openRepairCount = computed(() => repairs.value.filter((r) => r.status === 'open').length);

const { installed, installedBattery, readings } = useBatteries();
const batteryReadings = computed(() => (installedBattery.value ? readings.value.get(installedBattery.value.id) ?? null : null));

const roles = flow.roles;
const milestonesNow = computed(() => sortMilestones(items.value).filter((m) => milestoneState(m, now.value) === 'current'));
const nextMilestone = computed(() => sortMilestones(items.value).find((m) => milestoneState(m, now.value) === 'upcoming') ?? null);

const clock = computed(() => new Date(now.value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));

// --- Staying on ---
// Keep the screen awake while the display is up (where the browser allows).
let wakeLock: { release: () => Promise<void> } | null = null;
async function keepAwake() {
  try {
    const api = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    if (api && document.visibilityState === 'visible') wakeLock = await api.request('screen');
  } catch {
    // Not supported or not allowed: the display still works.
  }
}
const isFullscreen = ref(!!document.fullscreenElement);
const onFullscreenChange = () => (isFullscreen.value = !!document.fullscreenElement);
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => undefined);
}
onMounted(() => {
  keepAwake();
  // The lock is dropped when the tab is hidden; take it again on return.
  document.addEventListener('visibilitychange', keepAwake);
  document.addEventListener('fullscreenchange', onFullscreenChange);
});
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', keepAwake);
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  wakeLock?.release().catch(() => undefined);
});
</script>

<template>
  <div class="display">
    <div v-if="!activeEvent" class="blank">
      <h1>Pit display</h1>
      <p>No event is set up yet. Set one up on the Schedule page.</p>
    </div>

    <template v-else>
      <section class="status" :style="flow.loaded.value ? { background: colors.bg, color: colors.fg } : {}">
        <h1>{{ flow.loaded.value ? headline : '…' }}</h1>
        <p v-if="flow.loaded.value" class="status-sub">
          <template v-if="status === 'pending' && pitLink.label">{{ pitLink.label }} · </template>
          <template v-if="elapsed">{{ elapsed }}</template>
        </p>
      </section>

      <div class="widgets" :class="[`count-${Math.min(layout.widgets.length, 6)}`, `rows-${Math.min(widgetRows, 4)}`]">
        <template v-for="widget in layout.widgets" :key="widget">
          <section v-if="widget === 'next_match'" class="widget">
            <h2>Next match</h2>
            <template v-if="nextMatch">
              <p class="big">{{ nextMatch.title }}</p>
              <p class="line">{{ isEstimate(nextMatch) ? '~' : '' }}{{ formatTime(nextMatch.start_at) }}</p>
              <p v-if="allianceName(nextMatch)" class="line alliance" :style="{ color: matchColor(nextMatch.match_info?.alliance) }">
                {{ allianceName(nextMatch) }} · {{ partners(nextMatch) }}
              </p>
            </template>
            <p v-else class="none">No more matches scheduled</p>
          </section>

          <section v-else-if="widget === 'countdown'" class="widget">
            <h2>{{ countdown ? countdown.label : 'Countdown' }}</h2>
            <template v-if="nextMatch && countdown">
              <p class="huge">{{ countdown.ms > 0 ? formatClock(countdown.ms) : 'Now' }}</p>
              <p class="line">{{ countdown.target === 'queue' ? `${nextMatch.title} · queue by ${formatTime(new Date(deadlines!.queueAt).toISOString())}` : `until ${nextMatch.title}` }}</p>
            </template>
            <p v-else class="none">No upcoming match</p>
          </section>

          <section v-else-if="widget === 'readiness'" class="widget">
            <h2>Readiness</h2>
            <template v-if="deadlines">
              <p class="line row" :class="{ late: deadline(deadlines.prepAt).late }">
                <span>Start prep</span><strong>{{ deadline(deadlines.prepAt).at }}</strong><span>{{ deadline(deadlines.prepAt).text }}</span>
              </p>
              <p class="line row" :class="{ late: deadline(deadlines.queueAt).late }">
                <span>Queue</span><strong>{{ deadline(deadlines.queueAt).at }}</strong><span>{{ deadline(deadlines.queueAt).text }}</span>
              </p>
              <p class="line row"><span>Open repairs</span><strong>{{ openRepairCount + repairsInProgress.length }}</strong><span></span></p>
            </template>
            <p v-else class="none">No upcoming match</p>
          </section>

          <section v-else-if="widget === 'current_match'" class="widget">
            <h2>Current match</h2>
            <template v-if="currentMatch">
              <p class="big">{{ currentMatch.title }}</p>
              <p v-if="allianceName(currentMatch)" class="line alliance" :style="{ color: matchColor(currentMatch.match_info?.alliance) }">
                {{ allianceName(currentMatch) }} · {{ partners(currentMatch) }}
              </p>
            </template>
            <p v-else class="none">Not in a match</p>
          </section>

          <section v-else-if="widget === 'checklist'" class="widget">
            <h2>Active checklist</h2>
            <template v-if="pitChecklist && pitProgress">
              <p class="big">{{ instanceTitle(pitChecklist.name, pitLink.label) }}</p>
              <p class="line">{{ pitProgress.done }} of {{ pitProgress.total }} steps</p>
              <div class="bar" aria-hidden="true"><span :style="{ width: `${pitProgress.total ? (pitProgress.done / pitProgress.total) * 100 : 0}%` }"></span></div>
              <p v-if="pitProgress.step" class="line">Now: {{ pitProgress.step }}</p>
            </template>
            <template v-else-if="openRuns.length">
              <p v-for="run in openRuns.slice(0, 3)" :key="run.id" class="line">{{ instanceTitle(run.checklist_name, run.label) }}</p>
            </template>
            <p v-else class="none">No checklist running</p>
          </section>

          <section v-else-if="widget === 'repair'" class="widget" :class="{ alert: repairsInProgress.length }">
            <h2>Active repair</h2>
            <template v-if="repairsInProgress.length">
              <p v-for="repair in repairsInProgress.slice(0, 3)" :key="repair.id" class="line repair">
                <strong>{{ repair.title }}</strong>
                <span>
                  {{ repair.assignee ?? 'Unassigned' }}<template v-if="repair.started_at"> · {{ formatElapsed(now - Date.parse(repair.started_at)) }}</template>
                </span>
              </p>
              <p v-if="repairsInProgress.length > 3" class="line">+{{ repairsInProgress.length - 3 }} more</p>
            </template>
            <p v-else class="none">{{ openRepairCount ? `None in progress · ${openRepairCount} waiting` : 'None' }}</p>
          </section>

          <section v-else-if="widget === 'battery'" class="widget" :class="{ warn: installedBattery?.status === 'suspect' }">
            <h2>Battery installed</h2>
            <template v-if="installedBattery">
              <p class="huge">{{ installedBattery.number }}</p>
              <p class="line">
                <template v-if="installed?.label">{{ installed.label }}</template>
                <template v-if="batteryReadings?.resting_voltage !== null && batteryReadings?.resting_voltage !== undefined">
                  · {{ formatReading(batteryReadings.resting_voltage, 2) }} V
                </template>
                <template v-if="installedBattery.status === 'suspect'"> · suspect</template>
              </p>
            </template>
            <p v-else class="none">Not recorded</p>
          </section>

          <section v-else-if="widget === 'roles'" class="widget">
            <h2>Pit responsibilities</h2>
            <template v-if="roles.length">
              <p v-for="role in roles" :key="role.id" class="line row">
                <span>{{ role.name }}</span><strong>{{ role.assignee || '—' }}</strong>
              </p>
            </template>
            <p v-else class="none">No roles set up</p>
          </section>

          <section v-else-if="widget === 'phase'" class="widget">
            <h2>Event phase</h2>
            <p class="big">{{ phase ? phaseLabels[phase] : 'Not started' }}</p>
            <p v-for="m in milestonesNow.slice(0, 2)" :key="m.id" class="line">Now: {{ m.title }}</p>
            <p v-if="nextMilestone" class="line">Next: {{ nextMilestone.title }} at {{ formatTime(nextMilestone.start_at) }}</p>
          </section>
        </template>
      </div>
    </template>

    <footer class="footer">
      <span>{{ activeEvent?.name ?? 'Preflight' }}</span>
      <span v-if="sync.status === 'offline'" class="offline">Offline</span>
      <span class="spacer"></span>
      <button class="footer-button" @click="toggleFullscreen">{{ isFullscreen ? 'Exit full screen' : 'Full screen' }}</button>
      <RouterLink to="/" class="footer-button">Exit display</RouterLink>
      <span class="clock">{{ clock }}</span>
    </footer>
  </div>
</template>

<style scoped>
/* Fills the screen and never scrolls: it's meant to be read, not operated.
   Sizes follow the viewport so the same layout works on any TV. */
.display {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 1.2vh;
  padding: 1.2vh 1.2vw;
  box-sizing: border-box;
  background: #0d1117;
  color: #f0f3f6;
  overflow: hidden;
}

.blank {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-size: 3vh;
}

.status {
  flex: 0 0 34vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 2vh;
  background: #30363d;
  text-align: center;
}

.status h1 {
  margin: 0;
  padding: 0 2vw;
  font-size: min(13vh, 9vw);
  line-height: 1.05;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.01em;
}

.status-sub {
  margin: 1vh 0 0;
  font-size: min(5vh, 4vw);
  font-variant-numeric: tabular-nums;
  opacity: 0.9;
}

.widgets {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-auto-rows: minmax(0, 1fr);
  gap: 1.2vh 1.2vw;
  /* Base size for everything in the widgets (their type is in em). */
  font-size: min(3.2vh, 2.2vw);
}

.widgets.rows-1 {
  font-size: min(4.2vh, 2.6vw);
}

.widgets.rows-3 {
  font-size: min(2.1vh, 1.7vw);
}

.widgets.rows-4 {
  font-size: min(1.5vh, 1.4vw);
}

.widgets.count-1 {
  grid-template-columns: minmax(0, 1fr);
}

.widgets.count-2,
.widgets.count-4 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.widget {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.6vh;
  min-width: 0;
  min-height: 0;
  padding: 1.5vh 1.5vw;
  border-radius: 1.6vh;
  border: 0.4vh solid transparent;
  background: #161b22;
  overflow: hidden;
}

.widget.alert {
  border-color: #c62828;
}

.widget.warn {
  border-color: #ffc107;
}

.widget h2 {
  margin: 0;
  font-size: 0.75em;
  font-weight: 600;
  opacity: 0.65;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.widget p {
  margin: 0;
}

.big {
  font-size: 1.7em;
  font-weight: 700;
  line-height: 1.1;
  overflow-wrap: anywhere;
}

.huge {
  font-size: 3.4em;
  font-weight: 800;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.line {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.alliance {
  font-weight: 700;
}

.row {
  display: flex;
  align-items: baseline;
  gap: 1vw;
}

.row span:first-child {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.75;
}

.row span:last-child {
  opacity: 0.75;
  font-size: 0.8em;
}

.row.late strong,
.row.late span:last-child {
  color: #ffc107;
  opacity: 1;
}

.repair {
  display: flex;
  flex-direction: column;
  white-space: normal;
}

.repair span {
  font-size: 0.8em;
  opacity: 0.75;
}

.none {
  opacity: 0.5;
}

.bar {
  height: 1.4vh;
  border-radius: 999px;
  background: #30363d;
  overflow: hidden;
}

.bar span {
  display: block;
  height: 100%;
  background: #ffc107;
}

.footer {
  flex: none;
  display: flex;
  align-items: center;
  gap: 1.5vw;
  font-size: min(2.4vh, 2vw);
  opacity: 0.75;
}

.spacer {
  flex: 1;
}

.offline {
  padding: 0 1vw;
  border-radius: 999px;
  border: 1px solid currentColor;
}

.footer-button {
  padding: 0.3vh 1vw;
  border: 1px solid #484f58;
  border-radius: 0.8vh;
  background: transparent;
  color: inherit;
  font: inherit;
  text-decoration: none;
  cursor: pointer;
}

.clock {
  font-size: 1.4em;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

/* Portrait or narrow screens: fewer columns. */
@media (max-aspect-ratio: 1/1) {
  .widgets,
  .widgets.count-4 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
