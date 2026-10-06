<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import '@material/web/button/filled-button';
import '@material/web/button/outlined-button';
import { useNow } from '@greybots/common/lib/now';
import ReportBars, { type BarRow } from '@/components/report/ReportBars.vue';
import DurationHistogram from '@/components/stats/DurationHistogram.vue';
import StatTile from '@/components/stats/StatTile.vue';
import TurnaroundBars from '@/components/stats/TurnaroundBars.vue';
import { useLiveQuery } from '@/lib/live-query';
import { eventRecordCount, lastEventChange, loadEventData, type EventData } from '@/lib/report/event-data';
import { buildEventReport, logKindLabels, repairDuration, type LogEntry } from '@/lib/report/event-report';
import { buildEventExport, exportFileName } from '@/lib/report/export';
import { getLastExport, recordExport, wipeEvent } from '@/lib/report/wipe';
import { downloadBlob } from '@/lib/report/zip';
import { repairStatusLabels } from '@/lib/repairs/repairs';
import { formatDateRange, formatTime } from '@/lib/schedule/dates';
import { getActiveEvent } from '@/lib/schedule/schedule-repo';
import type { ActiveEvent } from '@/lib/schedule/types';
import { formatDuration, mean, median } from '@/lib/stats/pit-stats';
import { useSessionStore } from '@/stores/session-store';
import { useSyncStore } from '@/stores/sync-store';

// Event report (admins, issue #110): how the pit and the robot did at the
// event, on paper. "Print" opens the browser's print dialog, which prints it
// or saves it as a PDF; only the report itself prints. The same data can be
// downloaded as a zip of CSV files, and, once both have been pulled, wiped.
// Built entirely from what's on the device.
const session = useSessionStore();
const sync = useSyncStore();
const now = useNow(60_000);

const activeEvent = useLiveQuery<ActiveEvent | null>(getActiveEvent, null);
const eventKey = computed(() => activeEvent.value?.event_key ?? '');
const data = useLiveQuery<EventData | null>(() => (activeEvent.value ? loadEventData(activeEvent.value) : null), null, eventKey);
const report = computed(() => (data.value ? buildEventReport(data.value, now.value) : null));
const recordCount = computed(() => (data.value ? eventRecordCount(data.value) : 0));

const generatedAt = computed(() =>
  new Date(now.value).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const time = (values: number[], pick: (v: number[]) => number = mean) => (values.length ? formatDuration(pick(values)) : '—');
const dateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '—';

// --- Numbers the sections share ---
const turnarounds = computed(() => report.value?.stats.turnarounds ?? []);
const totals = computed(() => turnarounds.value.map((t) => t.total));
const withoutRepairs = computed(() => turnarounds.value.map((t) => t.withoutRepairs));
const repairTimes = computed(() => turnarounds.value.filter((t) => t.repair > 0).map((t) => t.repair));
const practice = computed(() => report.value?.stats.practicePrep.map((s) => s.ms) ?? []);
const matchTitle = computed(() => new Map((report.value?.matches ?? []).map((m) => [m.match_key, m.title])));
const outstandingCount = computed(() => {
  const o = report.value?.outstanding;
  return o ? o.repairs.length + o.tasks.length + o.runs.length + o.batteries.length : 0;
});

// --- Charts ---
const stageTotal = computed(() => report.value?.stages.reduce((sum, s) => sum + s.ms, 0) ?? 0);
const marginRows = computed<BarRow[]>(() =>
  (report.value?.margins ?? []).map((m) => ({
    label: m.matchTitle,
    value: m.ms,
    text: m.ms >= 0 ? formatDuration(m.ms) : `${formatDuration(-m.ms)} late`,
    flag: m.ms < 10 * 60_000
  }))
);
const checklistRows = computed<BarRow[]>(() =>
  (report.value?.stats.checklists ?? [])
    .filter((c) => c.samples.length)
    .map((c) => {
      const average = mean(c.samples.map((s) => s.ms));
      return { label: c.name, sub: plural(c.samples.length, 'run'), value: average, text: formatDuration(average) };
    })
);
const stepRows = computed<BarRow[]>(() =>
  (report.value?.stats.steps ?? [])
    .filter((s) => mean(s.samples) > 0)
    .slice(0, 12)
    .map((s) => ({ label: s.step, sub: `${s.checklist} · ${plural(s.samples.length, 'time')}`, value: mean(s.samples), text: formatDuration(mean(s.samples)) }))
);
const peopleRows = computed<BarRow[]>(() => {
  const counts = new Map<string, number>();
  for (const check of data.value?.checks ?? []) {
    if (!check.completed_at) continue;
    const name = check.completed_by_name ?? 'Unknown';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value, text: plural(value, 'step') }));
});
const subsystemRows = computed<BarRow[]>(() =>
  (report.value?.repairsBySubsystem ?? []).map((s) => ({
    label: s.name,
    value: s.count,
    text: `${plural(s.count, 'repair')}${s.ms ? ` · ${formatDuration(s.ms)}` : ''}`
  }))
);
const repairPerTurnaroundRows = computed<BarRow[]>(() =>
  turnarounds.value
    .filter((t) => t.repair > 0)
    .map((t) => ({ label: t.matchTitle ? `Before ${t.matchTitle}` : formatTime(t.startedAt), value: t.repair, text: formatDuration(t.repair) }))
);
const repairDurations = computed(() => (report.value?.repairLog ?? []).map(repairDuration).filter((ms): ms is number => ms !== null));

// --- As-run notes, a day at a time ---
const logDays = computed(() => {
  const days: { day: string; entries: LogEntry[] }[] = [];
  for (const entry of report.value?.log ?? []) {
    const day = new Date(entry.at).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    const last = days[days.length - 1];
    if (last?.day === day) last.entries.push(entry);
    else days.push({ day, entries: [entry] });
  }
  return days;
});

const print = () => window.print();

// --- Data export ---
const lastExport = ref<string | null>(null);
watch(eventKey, async (key) => (lastExport.value = key ? await getLastExport(key) : null), { immediate: true });
const lastChange = computed(() => (data.value ? lastEventChange(data.value) : null));
// The download is still the whole event: nothing changed since.
const exportCurrent = computed(() => !!lastExport.value && (!lastChange.value || Date.parse(lastExport.value) >= Date.parse(lastChange.value)));
const exportError = ref<string | null>(null);

async function downloadData() {
  if (!data.value || !report.value) return;
  exportError.value = null;
  try {
    const at = new Date();
    downloadBlob(buildEventExport(data.value, report.value, at), exportFileName(data.value, at));
    await recordExport(eventKey.value, at.toISOString());
    lastExport.value = at.toISOString();
  } catch (e) {
    exportError.value = e instanceof Error ? e.message : String(e);
  }
}

// --- Wipe (two steps) ---
// 0: not started. 1: confirm the report and data are saved. 2: type the event
// key to delete.
const wipeStep = ref<0 | 1 | 2>(0);
const savedReport = ref(false);
const typedKey = ref('');
const wiping = ref(false);
const wipeError = ref<string | null>(null);
const wipedMessage = ref<string | null>(null);
const keyMatches = computed(() => typedKey.value.trim().toLowerCase() === eventKey.value.toLowerCase() && !!eventKey.value);

function cancelWipe() {
  wipeStep.value = 0;
  savedReport.value = false;
  typedKey.value = '';
  wipeError.value = null;
}

async function wipe() {
  if (!keyMatches.value || !exportCurrent.value || wiping.value) return;
  wiping.value = true;
  wipeError.value = null;
  const name = activeEvent.value?.name ?? eventKey.value;
  try {
    await wipeEvent(eventKey.value, session.user?.name ?? null);
    cancelWipe();
    wipedMessage.value = `All Preflight data for ${name} has been deleted. Other devices drop their copies the next time they sync.`;
  } catch (e) {
    wipeError.value = e instanceof Error ? e.message : String(e);
  } finally {
    wiping.value = false;
  }
}
</script>

<template>
  <div v-if="!activeEvent" class="card">
    <h2>No event set up</h2>
    <p class="hint">The report is for the active event.</p>
    <RouterLink to="/schedule" class="panel-link">Set up the event on the Schedule page →</RouterLink>
  </div>

  <div v-else class="report-view">
    <header class="controls no-print">
      <div class="heading">
        <h1>Event report</h1>
        <p class="hint">
          How the pit and the robot did at {{ activeEvent.name }}: a summary, what's still open, pit and robot performance, and everything that
          happened, in order. Print it, or choose “Save as PDF” in the print dialog. The data itself downloads as a zip of CSV files.
        </p>
      </div>
      <div class="options">
        <md-filled-button :disabled="!report" @click="print">Print / save as PDF</md-filled-button>
        <md-outlined-button :disabled="!report" @click="downloadData">Download data (.zip)</md-outlined-button>
        <span v-if="lastExport" class="hint">Data last downloaded {{ dateTime(lastExport) }}{{ exportCurrent ? '' : ' (it has changed since)' }}.</span>
      </div>
      <p v-if="exportError" class="error-text">{{ exportError }}</p>
      <p class="hint">
        Built from what's on this device.
        <template v-if="sync.pendingCount > 0">{{ plural(sync.pendingCount, 'change') }} here {{ sync.pendingCount === 1 ? "hasn't" : "haven't" }} synced yet. </template>
        Sync first so it includes what the other devices recorded{{ sync.lastSyncAt ? ` (last synced ${dateTime(sync.lastSyncAt)})` : '' }}.
        <button class="link-button" :disabled="sync.syncing || !sync.hasServerSession" @click="sync.syncNow()">{{ sync.syncing ? 'Syncing…' : 'Sync now' }}</button>
      </p>
    </header>

    <section class="panel wipe no-print">
      <h2>Wipe this event's data</h2>
      <p class="hint">
        Once the report and the data are saved, the event's data can be removed for good, from the server and from every device: the schedule,
        status history, checklists, repairs, tasks, and notes ({{ plural(recordCount, 'record') }}). Batteries, pit setup, and settings are
        kept. This can't be undone.
      </p>
      <p v-if="wipedMessage" class="success-text">{{ wipedMessage }}</p>

      <template v-if="wipeStep === 0">
        <p v-if="!recordCount" class="hint">There's nothing recorded for this event.</p>
        <p v-else-if="!lastExport" class="hint">Download the data first.</p>
        <p v-else-if="!exportCurrent" class="hint">The data has changed since it was last downloaded. Download it again first.</p>
        <div class="form-row">
          <button class="danger" :disabled="!recordCount || !exportCurrent" @click="wipeStep = 1">Wipe event data…</button>
        </div>
      </template>

      <template v-else-if="wipeStep === 1">
        <p><strong>Step 1 of 2.</strong> Make sure nothing is lost:</p>
        <ul class="checks">
          <li>The data was downloaded {{ dateTime(lastExport) }} and hasn't changed since.</li>
          <li>Every other device has synced. Anything a device hasn't sent yet is lost.</li>
        </ul>
        <label class="confirm"><input v-model="savedReport" type="checkbox" /> I've saved the PDF report and I have the downloaded data.</label>
        <div class="form-row">
          <button class="danger" :disabled="!savedReport || !exportCurrent" @click="wipeStep = 2">Continue</button>
          <button class="plain" @click="cancelWipe">Cancel</button>
        </div>
      </template>

      <template v-else>
        <p>
          <strong>Step 2 of 2.</strong> Type the event key <code>{{ eventKey }}</code> to delete {{ plural(recordCount, 'record') }} for
          {{ activeEvent.name }}.
        </p>
        <label class="field">
          <span>Event key</span>
          <input v-model="typedKey" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" />
        </label>
        <p v-if="!exportCurrent" class="error-text">The data has changed since it was downloaded. Cancel and download it again.</p>
        <p v-if="wipeError" class="error-text">{{ wipeError }}</p>
        <div class="form-row">
          <button class="danger filled" :disabled="!keyMatches || !exportCurrent || wiping" @click="wipe">
            {{ wiping ? 'Deleting…' : 'Delete permanently' }}
          </button>
          <button class="plain" :disabled="wiping" @click="cancelWipe">Cancel</button>
        </div>
      </template>
    </section>

    <!-- Everything below is the paper. Always black on white. -->
    <div v-if="report && data" class="paper">
      <!-- 1. Summary -->
      <article class="sheet">
        <header class="cover">
          <p class="kicker">Preflight event report · Team {{ activeEvent.team_number }}</p>
          <h2>{{ activeEvent.name }}</h2>
          <p class="meta">
            {{ activeEvent.event_key }} · {{ formatDateRange(activeEvent.start_date, activeEvent.end_date) }} · generated {{ generatedAt }}
          </p>
        </header>

        <h3>Summary</h3>
        <p v-if="!recordCount" class="none">Nothing has been recorded for this event yet.</p>
        <section class="tiles">
          <StatTile label="Matches played" :value="`${report.matchesPlayed}`" :detail="`of ${report.matches.length} on the schedule`" />
          <StatTile label="Turnarounds" :value="`${turnarounds.length}`" :detail="`${repairTimes.length} with repairs`" />
          <StatTile label="Average turnaround" :value="time(totals)" :detail="`Median ${time(totals, median)}`" />
          <StatTile
            label="Repairs"
            :value="`${data.repairs.length}`"
            :detail="`${data.repairs.filter((r) => r.status === 'done').length} finished`"
          />
          <StatTile label="Checklist steps checked" :value="`${data.checks.filter((c) => c.completed_at).length}`" :detail="plural(report.instances.length, 'checklist run')" />
          <StatTile label="Still open" :value="`${outstandingCount}`" detail="repairs, tasks, checklists, batteries" />
        </section>

        <div class="columns">
          <section>
            <h4>Highlights</h4>
            <ul v-if="report.highlights.length">
              <li v-for="line in report.highlights" :key="line">{{ line }}</li>
            </ul>
            <p v-else class="none">Nothing to report yet.</p>
          </section>
          <section>
            <h4>Areas of improvement</h4>
            <ul v-if="report.improvements.length">
              <li v-for="line in report.improvements" :key="line">{{ line }}</li>
            </ul>
            <p v-else class="none">Nothing stands out.</p>
          </section>
        </div>

        <figure v-if="stageTotal > 0" class="share viz-root">
          <figcaption><span class="chart-title">Where the pit time went</span></figcaption>
          <div class="share-bar" role="img" :aria-label="report.stages.map((s) => `${s.label}: ${formatDuration(s.ms)}`).join(', ')">
            <template v-for="stage in report.stages" :key="stage.key">
              <span v-if="stage.ms > 0" class="share-part" :class="stage.key" :style="{ flexGrow: stage.ms }"></span>
            </template>
          </div>
          <ul class="share-legend">
            <li v-for="stage in report.stages" :key="stage.key">
              <span class="swatch" :class="stage.key"></span>{{ stage.label }}: {{ formatDuration(stage.ms) }} ({{ Math.round((stage.ms / stageTotal) * 100) }}%)
            </li>
          </ul>
        </figure>

        <ReportBars
          title="Ready before each match"
          hint="How long the robot was ready before its match started. Under 10 minutes is marked."
          :rows="marginRows"
          empty="No turnaround could be matched to a match yet."
        />
      </article>

      <!-- 2. Outstanding items -->
      <article class="sheet">
        <h3>Outstanding items</h3>
        <p class="lede">Still incomplete at the end of the event, to finish at the shop.</p>
        <p v-if="!outstandingCount" class="none">Nothing outstanding.</p>

        <template v-if="report.outstanding.repairs.length">
          <h4>Repairs not finished ({{ report.outstanding.repairs.length }})</h4>
          <table>
            <thead>
              <tr><th class="box"></th><th>Repair</th><th>Subsystem</th><th>Owner</th><th>Status</th><th>Logged</th></tr>
            </thead>
            <tbody>
              <tr v-for="repair in report.outstanding.repairs" :key="repair.id">
                <td class="box"><span></span></td>
                <td>
                  <strong>{{ repair.title }}</strong>
                  <div v-if="repair.details" class="sub">{{ repair.details }}</div>
                </td>
                <td>{{ [repair.subsystem, repair.component].filter(Boolean).join(' · ') || '—' }}</td>
                <td>{{ repair.assignee ?? 'Unassigned' }}</td>
                <td>{{ repairStatusLabels[repair.status] }}</td>
                <td>{{ dateTime(repair.reported_at) }}</td>
              </tr>
            </tbody>
          </table>
        </template>

        <template v-if="report.outstanding.tasks.length">
          <h4>Tasks not done ({{ report.outstanding.tasks.length }})</h4>
          <table>
            <thead>
              <tr><th class="box"></th><th>Task</th><th>Owner</th><th>Match</th><th>Started</th></tr>
            </thead>
            <tbody>
              <tr v-for="task in report.outstanding.tasks" :key="task.id">
                <td class="box"><span></span></td>
                <td>
                  <strong>{{ task.title }}</strong>
                  <div v-if="task.notes" class="sub">{{ task.notes }}</div>
                </td>
                <td>{{ task.assignee ?? 'Unassigned' }}</td>
                <td>{{ (task.match_key && matchTitle.get(task.match_key)) || '—' }}</td>
                <td>{{ task.started_at ? dateTime(task.started_at) : 'Not started' }}</td>
              </tr>
            </tbody>
          </table>
        </template>

        <template v-if="report.outstanding.runs.length">
          <h4>Checklists left unfinished ({{ report.outstanding.runs.length }})</h4>
          <table>
            <thead>
              <tr><th class="box"></th><th>Checklist</th><th>For</th><th>Started</th><th>By</th></tr>
            </thead>
            <tbody>
              <tr v-for="run in report.outstanding.runs" :key="run.id">
                <td class="box"><span></span></td>
                <td><strong>{{ run.checklist_name }}</strong></td>
                <td>{{ run.label ?? '—' }}</td>
                <td>{{ dateTime(run.started_at) }}</td>
                <td>{{ run.started_by_name ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </template>

        <template v-if="report.outstanding.batteries.length">
          <h4>Batteries marked suspect ({{ report.outstanding.batteries.length }})</h4>
          <table>
            <thead>
              <tr><th class="box"></th><th>Battery</th><th>Set</th><th>Notes</th></tr>
            </thead>
            <tbody>
              <tr v-for="battery in report.outstanding.batteries" :key="battery.id">
                <td class="box"><span></span></td>
                <td><strong>Battery {{ battery.number }}</strong>{{ battery.label ? ` · ${battery.label}` : '' }}</td>
                <td>{{ battery.set_name ?? '—' }}</td>
                <td>{{ battery.notes ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </article>

      <!-- 3. Pit performance -->
      <article class="sheet">
        <h3>Pit performance</h3>
        <p class="lede">
          A turnaround runs from the robot coming into the pit to it being ready. Practice field time, breaks, and time sitting ready are never
          counted.
        </p>
        <p v-if="!turnarounds.length" class="none">No completed turnarounds were recorded.</p>

        <section class="tiles">
          <StatTile label="Average turnaround, with repairs" :value="time(totals)" :detail="`Median ${time(totals, median)} · ${plural(turnarounds.length, 'turnaround')}`" />
          <StatTile label="Average turnaround, without repairs" :value="time(withoutRepairs)" :detail="`Median ${time(withoutRepairs, median)}`" />
          <StatTile label="Average repair time, when there is one" :value="time(repairTimes)" :detail="`${repairTimes.length} of ${plural(turnarounds.length, 'turnaround')} had repairs`" />
          <StatTile label="Practice field prep, average" :value="time(practice)" :detail="practice.length ? plural(practice.length, 'trip') : 'No practice field trips'" />
        </section>

        <TurnaroundBars :turnarounds="turnarounds" />

        <ReportBars title="Average time on each checklist" hint="Repairs not counted." :rows="checklistRows" empty="No checklist was completed." />
        <ReportBars
          title="Slowest steps"
          hint="Average time from the step before it, counting only time spent on that checklist."
          :rows="stepRows"
          empty="No step times were recorded."
        />
        <ReportBars title="Ready before each match" :rows="marginRows" empty="No turnaround could be matched to a match." />
        <ReportBars title="Checklist steps checked off, by person" :rows="peopleRows" empty="No steps were checked." />

        <section class="charts">
          <DurationHistogram title="Turnaround, with repairs" :values="totals" unit="turnaround" />
          <DurationHistogram title="Turnaround, without repairs" :values="withoutRepairs" unit="turnaround" />
          <DurationHistogram
            v-for="checklist in report.stats.checklists"
            :key="checklist.name"
            :title="`${checklist.name} checklist`"
            :values="checklist.samples.map((s) => s.ms)"
          />
          <DurationHistogram title="Practice field prep" :values="practice" unit="trip" />
        </section>

        <template v-if="turnarounds.length">
          <h4>Every turnaround</h4>
          <table>
            <thead>
              <tr><th>Turnaround</th><th>In pit</th><th>Ready</th><th>Post-match</th><th>Repairs</th><th>Pre-match</th><th>Total</th></tr>
            </thead>
            <tbody>
              <tr v-for="t in turnarounds" :key="t.key">
                <td>{{ t.matchTitle ? `Before ${t.matchTitle}` : '—' }}</td>
                <td>{{ dateTime(t.startedAt) }}</td>
                <td>{{ dateTime(t.readyAt) }}</td>
                <td>{{ formatDuration(t.post) }}</td>
                <td>{{ t.repair ? formatDuration(t.repair) : '—' }}</td>
                <td>{{ formatDuration(t.pre) }}</td>
                <td><strong>{{ formatDuration(t.total) }}</strong></td>
              </tr>
            </tbody>
          </table>
        </template>
      </article>

      <!-- 4. Robot performance -->
      <article class="sheet">
        <h3>Robot performance</h3>
        <p class="lede">How the robot held up: what needed repair, what failed its checks, and which batteries it ran on.</p>

        <section class="tiles">
          <StatTile label="Repairs logged" :value="`${data.repairs.length}`" :detail="`${data.repairs.filter((r) => r.status === 'done').length} finished`" />
          <StatTile label="Time spent on repairs" :value="repairDurations.length ? formatDuration(repairDurations.reduce((a, b) => a + b, 0)) : '—'" :detail="`Average ${time(repairDurations)} each`" />
          <StatTile label="Checklist steps failed" :value="`${report.failedChecks.length}`" detail="pass / fail steps" />
          <StatTile label="Battery changes" :value="`${report.batteryUses.length}`" :detail="`${new Set(report.batteryUses.map((u) => u.use.battery_id)).size} batteries used`" />
        </section>

        <ReportBars title="Repairs by subsystem" hint="With the time worked on the finished ones." :rows="subsystemRows" empty="No repairs were logged." />
        <ReportBars title="Repair time in each turnaround" :rows="repairPerTurnaroundRows" empty="No turnaround was stopped for repairs." />

        <h4>Repair log</h4>
        <p v-if="!report.repairLog.length" class="none">No repairs were logged.</p>
        <table v-else>
          <thead>
            <tr><th>Logged</th><th>Repair</th><th>Subsystem</th><th>Match</th><th>Who</th><th>Status</th><th>Took</th></tr>
          </thead>
          <tbody>
            <tr v-for="repair in report.repairLog" :key="repair.id">
              <td>{{ dateTime(repair.reported_at) }}</td>
              <td>
                <strong>{{ repair.title }}</strong>
                <div v-if="repair.details" class="sub">{{ repair.details }}</div>
              </td>
              <td>{{ [repair.subsystem, repair.component].filter(Boolean).join(' · ') || '—' }}</td>
              <td>{{ (repair.match_key && matchTitle.get(repair.match_key)) || '—' }}</td>
              <td>{{ repair.assignee ?? repair.finished_by_name ?? '—' }}</td>
              <td>{{ repairStatusLabels[repair.status] }}</td>
              <td>{{ repairDuration(repair) === null ? '—' : formatDuration(repairDuration(repair)!) }}</td>
            </tr>
          </tbody>
        </table>

        <template v-if="report.failedChecks.length">
          <h4>Checks that failed</h4>
          <table>
            <thead>
              <tr><th>When</th><th>Checklist</th><th>Step</th><th>Match</th><th>By</th></tr>
            </thead>
            <tbody>
              <tr v-for="check in report.failedChecks" :key="check.id">
                <td>{{ dateTime(check.completed_at) }}</td>
                <td>{{ check.checklist_name ?? '—' }}</td>
                <td><strong>{{ check.step_title ?? '—' }}</strong></td>
                <td>{{ (check.match_key && matchTitle.get(check.match_key)) || '—' }}</td>
                <td>{{ check.completed_by_name ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </template>

        <h4>Batteries in the robot</h4>
        <p v-if="!report.batteryUses.length" class="none">No battery was recorded going into the robot.</p>
        <table v-else>
          <thead>
            <tr><th>Battery</th><th>For</th><th>In</th><th>Out</th><th>Wh discharged</th><th>By</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in report.batteryUses" :key="row.use.id">
              <td><strong>{{ row.number ?? '?' }}</strong></td>
              <td>{{ row.use.label ?? row.use.kind }}</td>
              <td>{{ dateTime(row.use.installed_at) }}</td>
              <td>{{ row.use.removed_at ? dateTime(row.use.removed_at) : 'Still in' }}</td>
              <td>{{ row.use.wh_discharged ?? '—' }}</td>
              <td>{{ row.use.installed_by_name ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </article>

      <!-- 5. Full event as-run notes -->
      <article class="sheet">
        <h3>Full event as-run notes</h3>
        <p class="lede">Everything that happened in the pit, from start to finish: {{ report.log.length }} {{ report.log.length === 1 ? 'entry' : 'entries' }}.</p>
        <p v-if="!report.log.length" class="none">Nothing was recorded.</p>
        <template v-for="day in logDays" :key="day.day">
          <h4>{{ day.day }}</h4>
          <table class="log">
            <tbody>
              <tr v-for="(entry, i) in day.entries" :key="i" :class="entry.kind">
                <td class="when">{{ formatTime(entry.at) }}</td>
                <td class="kind">{{ logKindLabels[entry.kind] }}</td>
                <td>
                  {{ entry.text }}
                  <span v-if="entry.detail" class="sub detail">{{ entry.detail }}</span>
                </td>
                <td class="who">{{ entry.by ?? '' }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </article>
    </div>
  </div>
</template>

<style scoped>
.report-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  width: 100%;
}

.controls,
.wipe {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  max-width: 8.5in;
  box-sizing: border-box;
}

.heading h1 {
  margin: 0;
  font-size: 1.8rem;
}

.hint {
  margin: 4px 0 0;
  opacity: 0.7;
  font-size: 0.9rem;
}

.options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.link-button {
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.link-button:disabled {
  opacity: 0.5;
  cursor: default;
}

.wipe h2 {
  margin: 0;
  font-size: 1.1rem;
}

.wipe p {
  margin: 0;
}

.checks {
  margin: 0;
  padding-left: 1.2em;
}

/* The panel is a column: a field keeps its own height. */
.wipe .field {
  flex: none;
  max-width: 320px;
}

.confirm {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.success-text {
  color: #2e7d32;
  font-weight: 600;
}

.danger,
.plain {
  padding: 8px 16px;
  border: 1px solid #c62828;
  border-radius: 6px;
  background: transparent;
  color: var(--primary-text-color);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.danger.filled {
  background: #c62828;
  color: #fff;
}

.plain {
  border-color: transparent;
  font-weight: 400;
}

.danger:disabled,
.plain:disabled {
  opacity: 0.4;
  cursor: default;
}

/* On screen: a stack of letter-width sheets. On paper: each section starts a
   new page and runs over as many as it needs. */
.paper {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 8.5in;
  /* The app's theme doesn't reach the paper. */
  --tile-background-color: #f0f0f0;
  --primary-text-color: #000;
  --table-shadow-color: transparent;
  --table-header-background-color: transparent;
  --table-header-text-color: #000;
  --table-odd-row-background: transparent;
  --table-even-row-background: transparent;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* The light chart palette, whatever the app theme. */
.paper :deep(.viz-root) {
  --viz-series-1: #2a78d6;
  --viz-series-2: #eb6834;
  --viz-series-3: #1baf7a;
}

/* Charts built for the screen: no table toggle on paper. */
.paper :deep(.table-toggle) {
  display: none;
}

.sheet {
  display: flex;
  flex-direction: column;
  gap: 0.14in;
  padding: 0.5in;
  box-sizing: border-box;
  background: #fff;
  color: #000;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 10pt;
  line-height: 1.3;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
}

.sheet p,
.sheet ul {
  margin: 0;
}

.cover {
  padding-bottom: 0.1in;
  border-bottom: 2pt solid #000;
}

.kicker {
  font-size: 9pt;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.cover h2 {
  margin: 0;
  font-size: 26pt;
  line-height: 1.05;
}

.meta,
.lede {
  font-size: 9pt;
  color: #444;
}

.sheet h3 {
  margin: 0;
  font-size: 18pt;
  font-weight: 700;
  line-height: 1.1;
}

.sheet h4 {
  margin: 0.06in 0 0;
  font-size: 11pt;
  font-weight: 700;
  break-after: avoid;
}

.none {
  color: #555;
}

.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(1.6in, 1fr));
  gap: 0.1in;
}

/* Tiles are sized for the screen; on the sheet they're smaller. */
.tiles :deep(.stat-tile) {
  padding: 0.08in 0.1in;
  break-inside: avoid;
}

.tiles :deep(.value) {
  font-size: 20pt;
}

.columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.25in;
}

.columns h4 {
  margin-top: 0;
}

.columns ul {
  display: flex;
  flex-direction: column;
  gap: 3pt;
  padding-left: 1.1em;
}

.charts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.15in;
}

.charts :deep(figure) {
  break-inside: avoid;
}

.share {
  display: flex;
  flex-direction: column;
  gap: 5pt;
  margin: 0;
  break-inside: avoid;
}

.chart-title {
  font-weight: 700;
}

.share-bar {
  display: flex;
  gap: 2px;
  height: 0.28in;
}

.share-part {
  min-width: 2px;
}

.share-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4pt 16pt;
  padding: 0;
  list-style: none;
}

.swatch {
  display: inline-block;
  width: 9pt;
  height: 9pt;
  margin-right: 4pt;
  vertical-align: -1pt;
}

.post {
  background: var(--viz-series-1);
}

.repair {
  background: var(--viz-series-2);
}

.pre {
  background: var(--viz-series-3);
}

/* Plain ruled tables, not the app's striped ones. */
.sheet table {
  width: 100%;
  margin: 0;
  border-collapse: collapse;
  font-family: inherit;
  font-size: 9pt;
}

.sheet tbody tr,
.sheet tbody tr:last-of-type {
  border-bottom: none;
}

.sheet th,
.sheet td {
  padding: 3pt 5pt;
  border-bottom: 0.5pt solid #bbb;
  text-align: left;
  vertical-align: top;
}

.sheet th {
  border-bottom: 1pt solid #000;
  font-size: 8pt;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

tr {
  break-inside: avoid;
}

.sub {
  font-size: 8.5pt;
  color: #444;
}

/* A box to tick when the item is done at the shop. */
.box {
  width: 14pt;
}

.box span {
  display: block;
  width: 9pt;
  height: 9pt;
  margin-top: 1pt;
  border: 1pt solid #000;
}

.log .when,
.log .kind,
.log .who {
  white-space: nowrap;
}

.log .when {
  width: 0.7in;
  font-variant-numeric: tabular-nums;
}

.log .kind {
  width: 0.7in;
  font-size: 8pt;
  text-transform: uppercase;
  color: #444;
}

.log .who {
  text-align: right;
  color: #444;
}

.log .detail {
  display: block;
  white-space: pre-wrap;
}

/* The turns of the day stand out from the steps between them. */
.log tr.status td,
.log tr.match td {
  font-weight: 700;
}

.log tr.match td {
  background: #eee;
}

@media (max-width: 700px) {
  .columns,
  .charts {
    grid-template-columns: 1fr;
  }

  .sheet {
    padding: 0.25in;
  }
}

@media print {
  .report-view,
  .paper {
    display: block;
    max-width: none;
  }

  /* The page margins come from @page. */
  .sheet {
    padding: 0;
    box-shadow: none;
  }

  /* Blocks need their own spacing once the sheet stops being a flex column
     (a flex container doesn't break across pages reliably). */
  .sheet {
    display: block;
  }

  .sheet > * + * {
    margin-top: 0.14in;
  }

  .sheet + .sheet {
    break-before: page;
    page-break-before: always;
  }
}
</style>

<style>
/* Applies while this page is the one being printed. */
@media print {
  @page {
    size: letter portrait;
    margin: 0.5in;
  }

  /* Paper is white whatever the app theme is. */
  html,
  body,
  #app {
    background: #fff !important;
  }

  .testing-banner,
  .update-banner {
    display: none !important;
  }
}
</style>
