<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import '@material/web/button/filled-button';
import '@material/web/button/outlined-button';
import Switch from '@greybots/common/components/Switch.vue';
import { useViewModeStore } from '@greybots/common/stores/view-mode-store';

import type { SignalLogFile } from '@shared/ipc';
import {
  scopeLabels,
  severalLogsLabels,
  theAutoReport,
  type SeveralLogs,
  type Pipeline,
  type Report,
  type ReportSummary,
  type ReportTemplate,
  type SavedView,
} from '@shared/library';
import { describeMatch, type MatchType } from '@shared/offload';
import { defaultCardFilter, filterCards, logCards, missingTemplates, type CardFilter, type LogCard } from '@shared/report-cards';
import type { PipelineStatus } from '@shared/reports';
import ReportFlags from '@/components/ReportFlags.vue';
import ReportViewer from '@/components/ReportViewer.vue';
import TemplateEditor from '@/components/TemplateEditor.vue';
import { formatTime, logCompanions } from '@/format';
import { severityColor } from '@/review';
import { usePlotStore } from '@/stores/plot-store';

// Reports (#148): made from templates, by hand or by pipelines as logs
// arrive; and the templates and pipelines themselves.
// data whose signals are named differently.

type Tab = 'reports' | 'templates' | 'pipelines';
const tabs: { id: Tab; label: string }[] = [
  { id: 'reports', label: 'Reports' },
  { id: 'templates', label: 'Templates' },
  { id: 'pipelines', label: 'Auto reports' }
];

const route = useRoute();
const router = useRouter();
const tab = computed<Tab>(() => (tabs.some((t) => t.id === route.query.tab) ? (route.query.tab as Tab) : 'reports'));
// Each step in (a log, a report) is a step in the history, so Back (and the
// mouse's back button) goes to where you were.
const go = (query: Record<string, string>) => {
  const same = Object.keys(query).length === Object.keys(route.query).length && Object.entries(query).every(([k, v]) => route.query[k] === v);
  if (!same) router.push({ query });
};

const reports = ref<ReportSummary[]>([]);
const templates = ref<ReportTemplate[]>([]);
const views = ref<SavedView[]>([]);
const pipelines = ref<Pipeline[]>([]);
const logs = ref<SignalLogFile[]>([]);
const problem = ref('');

const cleanError = (error: unknown) => (error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

async function load() {
  try {
    const api = window.diagnostics;
    [reports.value, templates.value, views.value, pipelines.value, logs.value] = await Promise.all([
      api.getReports(), api.getLibrary('template'), api.getLibrary('view'), api.getLibrary('pipeline'), api.getSignalLogs()
    ]);
  } catch (error) {
    problem.value = cleanError(error);
  }
}

const logLabel = (log: SignalLogFile) =>
  `${log.match ? describeMatch(log.match) : log.name} · ${formatTime(log.recorded)}${log.robot ? ` · ${log.robot}` : ''}${logCompanions(log)}`;
// Logs a report can be made from, newest first; Driver Station logs on their own last.
const reportLogs = computed(() => [...logs.value].sort((a, b) =>
  Number(!a.localPath && a.hoots.length === 0) - Number(!b.localPath && b.hoots.length === 0) || b.recorded.localeCompare(a.recorded)));

// --- Reports ---

const openReport = ref<Report | null>(null);
watch(() => route.query.report, async (id) => {
  openReport.value = typeof id === 'string' ? await window.diagnostics.getReport(id).catch(() => null) : null;
}, { immediate: true });

// Running one template on the logs picked from the list: a few logs at a
// time (the main process keeps three open). Logs that already have a report
// from it are left out unless asked.
const batchTemplate = ref('');
const batchAgain = ref(false);
const selected = ref(new Set<string>());
const batch = ref<{ done: number; total: number } | null>(null);

// The reports, by log: a card for each log, with its reports and flags for
// the errors and warnings they found. Filterable; by default only logs with
// reports. The filter is kept between visits.
const viewMode = useViewModeStore();
const flagColor = (severity: 'error' | 'warning') => severityColor(severity, viewMode.isDarkMode);
const cardFilterKey = 'reports.cardFilter';
function loadCardFilter(): CardFilter {
  try {
    const saved = JSON.parse(localStorage.getItem(cardFilterKey) ?? 'null') as Partial<CardFilter> | null;
    return {
      ...defaultCardFilter,
      event: typeof saved?.event === 'string' && saved.event ? saved.event : null,
      realMatches: saved?.realMatches === true,
      analyzedOnly: saved?.analyzedOnly !== false
    };
  } catch {
    return { ...defaultCardFilter };
  }
}
const cardFilter = ref<CardFilter>(loadCardFilter());
watch(cardFilter, (value) => localStorage.setItem(cardFilterKey, JSON.stringify({ ...value, query: '' })), { deep: true });
const cards = computed(() => logCards(logs.value, reports.value));
const cardEvents = computed(() => [...new Set(cards.value.map((card) => card.match?.event.toUpperCase()).filter((e): e is string => !!e))].sort());
const shownCards = computed(() => filterCards(cards.value, cardFilter.value));
// Many logs have no reports (every Driver Station log, for one): a page at
// a time when they're shown.
const cardPage = 60;
const cardLimit = ref(cardPage);
watch(cardFilter, () => (cardLimit.value = cardPage), { deep: true });

// --- One log, focused: its reports, what they found, and running the rest ---
const focusedCard = computed(() => (typeof route.query.log === 'string' ? cards.value.find((c) => c.id === route.query.log) ?? null : null));
// Where a report open is from, for the way back.
const reportCard = computed(() => (openReport.value ? cards.value.find((c) => c.id === openReport.value!.logId) ?? null : null));
const crumbCard = computed(() => reportCard.value ?? focusedCard.value);
// Which of the log's reports found each problem.
const foundBy = (card: LogCard, id: string) =>
  card.reports.filter((r) => r.problems.some((p) => p.id === id)).map((r) => r.templateName).join(', ');
const reportErrors = (r: ReportSummary) => r.problems.filter((p) => p.severity === 'error');
const reportWarnings = (r: ReportSummary) => r.problems.filter((p) => p.severity === 'warning');

// Back to where you were, or up a level when there's nowhere to go back to
// (the app opened on a report).
function back() {
  if (window.history.state?.back) router.back();
  else if (openReport.value && reportCard.value) go({ tab: 'reports', log: reportCard.value.id });
  else go({ tab: 'reports' });
}

const plotStore = usePlotStore();
function openInSignals(card: LogCard) {
  plotStore.logId = card.id;
  plotStore.setView(null);
  router.push('/signals');
}
const cardWhen = (card: LogCard) => (card.log ? formatTime(card.recorded) : 'Log no longer in the data folder');

// The reports a log doesn't have yet, run from its card: one from each
// template that applies to its robot and hasn't made one for it. All of a
// log's at once, and several logs at once (the main process keeps a few
// logs open, so they don't take turns loading). Each card fills in as its
// reports come.
const missingFor = (card: LogCard) => missingTemplates(card, templates.value);
const running = ref(new Map<string, { done: number; total: number }>());
async function makeMissing(card: LogCard) {
  const wanted = missingFor(card);
  if (running.value.has(card.id) || wanted.length === 0) return;
  const setRun = (run: { done: number; total: number } | null) => {
    const next = new Map(running.value);
    if (run) next.set(card.id, run);
    else next.delete(card.id);
    running.value = next;
  };
  setRun({ done: 0, total: wanted.length });
  const failed: string[] = [];
  await Promise.all(wanted.map(async (template) => {
    try {
      await window.diagnostics.generateReport(template.id, card.id);
      reports.value = await window.diagnostics.getReports();
    } catch (error) {
      failed.push(`${template.name}: ${cleanError(error)}`);
    } finally {
      const run = running.value.get(card.id);
      if (run) setRun({ ...run, done: run.done + 1 });
    }
  }));
  setRun(null);
  if (failed.length) problem.value = `${card.title}: ${failed.join('; ')}`;
}
const makeLabel = (card: LogCard) => {
  const run = running.value.get(card.id);
  if (run) return `Running… ${run.done} of ${run.total} done`;
  const count = missingFor(card).length;
  return card.reports.length ? `Run ${count} more` : `Run ${count} report${count === 1 ? '' : 's'}`;
};

const isSelected = (card: LogCard) => selected.value.has(card.id);
function setSelected(card: LogCard, on: boolean) {
  const next = new Set(selected.value);
  if (on) next.add(card.id);
  else next.delete(card.id);
  selected.value = next;
}
// Every log shown (that's still in the data folder), or none.
const selectable = computed(() => shownCards.value.filter((card) => card.log));
const allShownSelected = computed(() => selectable.value.length > 0 && selectable.value.every(isSelected));
function selectAllShown(on: boolean) {
  const next = new Set(selected.value);
  for (const card of selectable.value) {
    if (on) next.add(card.id);
    else next.delete(card.id);
  }
  selected.value = next;
}
// The picked logs it would run on.
const batchTargets = computed(() => cards.value.filter((card) => card.log && selected.value.has(card.id) &&
  (batchAgain.value || !card.reports.some((r) => r.templateId === batchTemplate.value))));
const batchLabel = computed(() => {
  if (batch.value) return `Running… ${batch.value.done} of ${batch.value.total} done`;
  const count = batchTargets.value.length;
  return `Run on ${count} log${count === 1 ? '' : 's'}`;
});
async function runBatch() {
  const targets = batchTargets.value;
  const templateId = batchTemplate.value;
  if (batch.value || !templateId || targets.length === 0) return;
  problem.value = '';
  batch.value = { done: 0, total: targets.length };
  const failed: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const card = targets[next++];
      try {
        await window.diagnostics.generateReport(templateId, card.id);
        reports.value = await window.diagnostics.getReports();
      } catch (error) {
        failed.push(`${card.title}: ${cleanError(error)}`);
      } finally {
        if (batch.value) batch.value = { ...batch.value, done: batch.value.done + 1 };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, targets.length) }, worker));
  batch.value = null;
  selected.value = new Set();
  if (failed.length) problem.value = failed.join('; ');
}

async function removeReport(id: string) {
  const logId = openReport.value?.logId;
  await window.diagnostics.deleteReport(id);
  await load();
  router.replace({ query: logId ? { tab: 'reports', log: logId } : { tab: 'reports' } });
}

const savedTo = ref('');
// On paper, light: a dark report is switched for the PDF, and back after.
// Drawn for paper in a window of its own, so nothing here changes.
async function savePdf() {
  if (!openReport.value) return;
  savedTo.value = await window.diagnostics.savePdf(openReport.value.id).catch((error) => { problem.value = cleanError(error); return ''; });
}

// A report's template, again a template of its own.
async function makeTemplate(report: Report) {
  const copy = JSON.parse(JSON.stringify(report.template)) as ReportTemplate;
  const saved = await window.diagnostics.saveLibraryItem({ ...copy, id: '', name: `${copy.name} (from a report)`, cloud: null, createdBy: null });
  await load();
  editing.value = saved as ReportTemplate;
  go({ tab: 'templates' });
}

// --- Templates ---

const editing = ref<ReportTemplate | null>(null);

function blankTemplate(): ReportTemplate {
  return {
    id: '', kind: 'template', name: 'New report', description: '', created: '', changed: '', createdBy: null, robot: null, cloud: null,
    scope: { type: 'match' },
    sections: [{ type: 'summary' }, { type: 'events', title: 'Errors and warnings', kinds: [], problemsOnly: true }]
  };
}

async function saveTemplate(template: ReportTemplate) {
  try {
    await window.diagnostics.saveLibraryItem(JSON.parse(JSON.stringify(template)));
    editing.value = null;
    await load();
  } catch (error) {
    problem.value = cleanError(error);
  }
}

async function removeItem(kind: 'template' | 'pipeline' | 'view', id: string) {
  problem.value = await window.diagnostics.deleteLibraryItem(kind, id).catch(cleanError);
  await load();
}

const startersAdded = ref<number | null>(null);
async function addStarters() {
  startersAdded.value = await window.diagnostics.addStarters();
  await load();
}

async function duplicate(template: ReportTemplate) {
  await window.diagnostics.saveLibraryItem({ ...JSON.parse(JSON.stringify(template)), id: '', name: `${template.name} (copy)`, cloud: null, createdBy: null });
  await load();
}

// --- Auto reports: one configuration (pipelines in the code and library) ---
const matchTypeChoices: { id: MatchType | 'none'; label: string }[] = [
  { id: 'qualification', label: 'Qualifications' },
  { id: 'elimination', label: 'Playoffs' },
  { id: 'practice', label: 'Practice matches' },
  { id: 'none', label: 'Not a match (pit, tests)' }
];

function blankPipeline(): Pipeline {
  return {
    id: '', kind: 'pipeline', name: 'Auto reports', description: '', created: '', changed: '', createdBy: null, robot: null, cloud: null,
    enabled: false, onOffload: true, onImport: false, robots: [], matchTypes: [], templateIds: [], several: 'all'
  };
}

const autoReport = computed(() => theAutoReport(pipelines.value) ?? blankPipeline());
const severalChoices = Object.entries(severalLogsLabels) as [SeveralLogs, string][];
// Saved as soon as anything changes; there's only the one.
async function updateAuto(change: Partial<Pipeline>) {
  try {
    await window.diagnostics.saveLibraryItem(JSON.parse(JSON.stringify({ ...autoReport.value, ...change })));
    pipelines.value = await window.diagnostics.getLibrary('pipeline');
  } catch (error) {
    problem.value = cleanError(error);
  }
}

const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);


const pipelineStatus = ref<PipelineStatus | null>(null);
const runLog = ref('');
async function runNow() {
  const pipeline = autoReport.value;
  if (!runLog.value || !pipeline.id) return;
  problem.value = '';
  const runs = await window.diagnostics.runPipeline(pipeline.id, [runLog.value]).catch((error) => { problem.value = cleanError(error); return []; });
  if (runs.length === 0 && !problem.value) problem.value = "It has no templates, or none apply to that log's robot.";
  await load();
}
let statusTimer: ReturnType<typeof setInterval> | undefined;
async function pollStatus() {
  const before = pipelineStatus.value?.recent.length ?? 0;
  pipelineStatus.value = await window.diagnostics.getPipelineStatus().catch(() => null);
  if ((pipelineStatus.value?.recent.length ?? 0) !== before) reports.value = await window.diagnostics.getReports().catch(() => reports.value);
}

const templateName = (id: string) => templates.value.find((t) => t.id === id)?.name ?? '(gone)';

onMounted(async () => {
  await load();
  batchTemplate.value = templates.value[0]?.id ?? '';
  await pollStatus();
  statusTimer = setInterval(pollStatus, 2000);
});
onUnmounted(() => clearInterval(statusTimer));
</script>

<template>
  <nav class="tabs no-print" aria-label="Reports">
    <button v-for="t in tabs" :key="t.id" class="tab" :aria-current="tab === t.id ? 'page' : undefined" @click="go({ tab: t.id })">{{ t.label }}</button>
  </nav>
  <p v-if="problem" class="error-text no-print">{{ problem }}</p>

  <!-- A report, open -->
  <nav v-if="tab === 'reports' && (openReport || focusedCard)" class="crumbs no-print" aria-label="Where you are">
    <md-outlined-button id="back" @click="back">← Back</md-outlined-button>
    <a href="#" @click.prevent="go({ tab: 'reports' })">Reports</a>
    <template v-if="crumbCard">
      <span aria-hidden="true">›</span>
      <a v-if="openReport" href="#" @click.prevent="go({ tab: 'reports', log: crumbCard.id })">{{ crumbCard.title }}</a>
      <span v-else aria-current="page">{{ crumbCard.title }}</span>
    </template>
    <template v-if="openReport">
      <span aria-hidden="true">›</span>
      <span aria-current="page">{{ openReport.template.name }}</span>
    </template>
  </nav>

  <section v-if="tab === 'reports' && openReport" id="report" class="card wide">
    <div class="card-actions no-print">
      <md-outlined-button id="save-pdf" @click="savePdf">Save as PDF</md-outlined-button>
      <md-outlined-button id="make-template" @click="makeTemplate(openReport)">Make a template from it</md-outlined-button>
      <md-outlined-button @click="removeReport(openReport.id)">Delete</md-outlined-button>
      <span v-if="savedTo" class="hint small path">Saved to {{ savedTo }}</span>
    </div>
    <ReportViewer :report="openReport" />
  </section>

  <!-- One log -->
  <section v-else-if="tab === 'reports' && focusedCard" id="log-view" class="card full">
    <header class="log-head">
      <div class="card-title">
        <h2>{{ focusedCard.title }}</h2>
        <span class="hint small">{{ cardWhen(focusedCard) }}{{ focusedCard.robot ? ` · ${focusedCard.robot}` : '' }}</span>
      </div>
      <md-outlined-button v-if="focusedCard.log" @click="openInSignals(focusedCard)">Open in Signals</md-outlined-button>
      <md-filled-button v-if="missingFor(focusedCard).length" class="make-missing" :disabled="running.has(focusedCard.id)"
        :title="`Runs: ${missingFor(focusedCard).map((t) => t.name).join(', ')}`"
        @click="makeMissing(focusedCard)">{{ makeLabel(focusedCard) }}</md-filled-button>
    </header>
    <ReportFlags v-if="focusedCard.reports.length" :errors="focusedCard.errors" :warnings="focusedCard.warnings" :missing="focusedCard.missing" />

    <h3>Reports</h3>
    <p v-if="!focusedCard.reports.length" class="hint">No reports yet.</p>
    <ul v-else class="log-reports">
      <li v-for="r in focusedCard.reports" :key="r.id" class="clickable" @click="go({ tab: 'reports', report: r.id })">
        <a href="#" :title="r.name" @click.prevent>{{ r.templateName }}</a>
        <ReportFlags :errors="reportErrors(r)" :warnings="reportWarnings(r)" :missing="r.missing" />
      </li>
    </ul>

    <template v-if="focusedCard.errors.length || focusedCard.warnings.length">
      <h3>Errors and warnings</h3>
      <ul class="problems">
        <li v-for="p in [...focusedCard.errors, ...focusedCard.warnings]" :key="p.id">
          <span class="dot" :style="{ background: flagColor(p.severity) }" aria-hidden="true"></span>
          <span>{{ p.title }}</span>
          <span class="hint small">{{ p.severity }} · {{ foundBy(focusedCard, p.id) }}</span>
        </li>
      </ul>
    </template>
  </section>

  <!-- Reports -->
  <template v-else-if="tab === 'reports'">
    <section id="run-report" class="card full">
      <h2>Run a report</h2>
      <p v-if="templates.length === 0" class="hint">There are no templates yet: make one under Templates.</p>
      <template v-else>
        <div class="field-row">
          <label class="pick">
            <span class="hint small">Template</span>
            <select id="batch-template" v-model="batchTemplate">
              <option v-for="t in templates" :key="t.id" :value="t.id">{{ t.name }}</option>
            </select>
          </label>
          <md-filled-button id="run-batch" :disabled="!!batch || batchTargets.length === 0" @click="runBatch">{{ batchLabel }}</md-filled-button>
        </div>
        <div class="chips">
          <label class="chip"><input v-model="batchAgain" type="checkbox" /><span>Run again on logs that already have it</span></label>
        </div>
        <p class="hint small">
          Pick the logs below: tick them, or narrow the list with the filter and pick every one shown.
          {{ selected.size }} picked<template v-if="selected.size && batchTargets.length < selected.size">, {{ selected.size - batchTargets.length }} already have it</template>.
        </p>
      </template>
    </section>
    <section class="card full">
      <h2>Reports by log</h2>
      <div class="card-filter" role="group" aria-label="Which logs to show">
        <input id="report-search" v-model="cardFilter.query" class="search" type="search" placeholder="Find a log or report" aria-label="Find a log or report" />
        <select id="report-event" v-model="cardFilter.event" aria-label="Event">
          <option :value="null">All events</option>
          <option v-for="event in cardEvents" :key="event" :value="event">{{ event }}</option>
        </select>
        <span class="chips">
          <label class="chip"><input id="report-real-matches" v-model="cardFilter.realMatches" type="checkbox" /><span>Real matches only</span></label>
          <label class="chip"><input id="report-analyzed-only" v-model="cardFilter.analyzedOnly" type="checkbox" /><span>Only logs with reports</span></label>
        </span>
      </div>
      <label v-if="selectable.length" class="pick-all">
        <input type="checkbox" class="pick-box" :checked="allShownSelected" @change="selectAllShown(($event.target as HTMLInputElement).checked)" />
        Pick all {{ selectable.length }} shown<template v-if="selected.size"> · {{ selected.size }} picked</template>
      </label>
      <p v-if="reports.length === 0 && cardFilter.analyzedOnly" class="hint">
        No reports yet. They're run here, or automatically when logs are downloaded or imported (Auto reports).
      </p>
      <p v-else-if="shownCards.length === 0" class="hint">No logs match the filter.</p>
      <div v-else id="report-cards" class="log-cards">
        <article v-for="card in shownCards.slice(0, cardLimit)" :key="card.id" class="log-card clickable" :class="{ gone: !card.log }"
          @click="go({ tab: 'reports', log: card.id })">
          <header>
            <input v-if="card.log" type="checkbox" class="pick-box" :checked="isSelected(card)" :aria-label="`Pick ${card.title}`"
              @click.stop @change="setSelected(card, ($event.target as HTMLInputElement).checked)" />
            <div class="card-title">
              <a href="#" class="card-name" @click.prevent>{{ card.title }}</a>
              <span class="hint small">{{ cardWhen(card) }}{{ card.robot ? ` · ${card.robot}` : '' }}</span>
            </div>
            <!-- Always at the top right: the reports this log doesn't have yet. -->
            <md-outlined-button v-if="missingFor(card).length" class="make-missing"
              :disabled="running.has(card.id)"
              :title="`Runs: ${missingFor(card).map((t) => t.name).join(', ')}`"
              @click.stop="makeMissing(card)">{{ makeLabel(card) }}</md-outlined-button>
          </header>
          <ul v-if="card.reports.length" class="card-reports">
            <li v-for="r in card.reports" :key="r.id">
              <a href="#" :title="r.name" @click.stop.prevent="go({ tab: 'reports', report: r.id })">{{ r.templateName }}</a>
            </li>
          </ul>
          <p v-else class="hint small">
            No reports yet.
          </p>
          <footer v-if="card.reports.length">
            <ReportFlags :errors="card.errors" :warnings="card.warnings" :missing="card.missing" />
          </footer>
        </article>
      </div>
      <div v-if="shownCards.length > cardLimit" class="card-actions">
        <md-outlined-button @click="cardLimit += cardPage">Show more ({{ shownCards.length - cardLimit }} left)</md-outlined-button>
      </div>
    </section>
  </template>

  <!-- Templates -->
  <template v-else-if="tab === 'templates'">
    <section v-if="editing" class="card">
      <h2>{{ editing.id ? `Change ${editing.name}` : 'New template' }}</h2>
      <TemplateEditor :template="editing" :views="views" @save="saveTemplate" @cancel="editing = null" />
    </section>
    <section v-else class="card">
      <h2>Report templates</h2>
      <p class="hint">
        What a report shows, and of which part of a log. Charts come from views saved on the Signals page; signals are found in each log by
        name, or by the end of their path.
      </p>
      <div class="card-actions">
        <md-filled-button id="new-template" @click="editing = blankTemplate()">New template</md-filled-button>
        <md-outlined-button id="add-starters" @click="addStarters">Add the starters</md-outlined-button>
        <span v-if="startersAdded !== null" class="hint small">
          {{ startersAdded ? `Added ${startersAdded} starter views, templates and auto reports.` : 'The starters are all here already.' }}
        </span>
      </div>
      <p class="hint small">
        The starters are the Match Report, Match Review, Autonomous and Power Analysis templates; views for Pit Health, Drivetrain, Shooter,
        Electrical, Match Review, Controls Debug, Automated Test and Battery Health; and an auto report for qualification matches (off until it's turned on).
      </p>
      <p v-if="templates.length === 0" class="hint">None yet.</p>
      <ul class="items">
        <li v-for="t in templates" :key="t.id" class="item">
          <div class="what">
            <strong>{{ t.name }}</strong>
            <span class="hint small">{{ scopeLabels[t.scope.type] }} · {{ t.sections.length }} sections{{ t.robot ? ` · ${t.robot} only` : '' }}{{ t.cloud ? ' · shared' : '' }}</span>
            <span v-if="t.description" class="small">{{ t.description }}</span>
          </div>
          <button class="link" @click="editing = JSON.parse(JSON.stringify(t))">Change</button>
          <button class="link" @click="duplicate(t)">Copy</button>
          <button class="link" @click="removeItem('template', t.id)">Delete</button>
        </li>
      </ul>
    </section>
  </template>

  <!-- Auto reports (pipelines in the code and library) -->
  <template v-else-if="tab === 'pipelines'">
    <section id="auto-report" class="card">
      <div class="auto-head">
        <h2>Auto report generation</h2>
        <Switch id="auto-report-on" class="on-switch" :model-value="autoReport.enabled" aria-label="Auto report generation on"
          @update:model-value="updateAuto({ enabled: $event })"></Switch>
        <span :class="autoReport.enabled ? 'on-text' : 'hint'">{{ autoReport.enabled ? 'On' : 'Off' }}</span>
      </div>
      <p class="hint">Runs reports by itself as logs arrive: each new log it applies to gets a report from every template ({{ templates.length }} now; ones saved for one robot only on that robot's logs). Saved as it's changed.</p>

      <fieldset>
        <legend class="hint small">Runs on logs that are</legend>
        <div class="chips">
          <label class="chip"><input type="checkbox" :checked="autoReport.onOffload" @change="updateAuto({ onOffload: !autoReport.onOffload })" /><span>Downloaded from the robot</span></label>
          <label class="chip"><input type="checkbox" :checked="autoReport.onImport" @change="updateAuto({ onImport: !autoReport.onImport })" /><span>Imported</span></label>
        </div>
      </fieldset>
      <fieldset>
        <legend class="hint small">When several new logs come at once (a backlog, say)</legend>
        <div class="chips">
          <label v-for="[id, label] in severalChoices" :key="id" class="chip">
            <input type="radio" name="several" :checked="autoReport.several === id" @change="updateAuto({ several: id })" /><span>{{ label }}</span>
          </label>
        </div>
      </fieldset>
      <fieldset>
        <legend class="hint small">From (none picked: any)</legend>
        <div class="chips">
          <label v-for="choice in matchTypeChoices" :key="choice.id" class="chip">
            <input type="checkbox" :checked="autoReport.matchTypes.includes(choice.id)" @change="updateAuto({ matchTypes: toggle(autoReport.matchTypes, choice.id) })" /><span>{{ choice.label }}</span>
          </label>
        </div>
      </fieldset>
      <label class="pick">
        <span class="hint small">Robots (none: any)</span>
        <input :value="autoReport.robots.join(', ')" placeholder="frc973, frc973B"
          @change="updateAuto({ robots: ($event.target as HTMLInputElement).value.split(',').map((r) => r.trim()).filter(Boolean) })" />
      </label>
      <div v-if="autoReport.id" class="run small">
        Run it now on
        <select v-model="runLog" aria-label="Log to run it on">
          <option v-for="log in reportLogs" :key="log.id" :value="log.id">{{ logLabel(log) }}</option>
        </select>
        <md-outlined-button :disabled="!runLog" @click="runNow">Run</md-outlined-button>
      </div>
      <p v-if="pipelines.length > 1" class="hint small">
        {{ pipelines.length - 1 }} older auto report configuration{{ pipelines.length === 2 ? ' is' : 's are' }} kept in the library but no longer run: there's one now.
      </p>
    </section>
    <section class="card">
      <h2>Lately</h2>
      <p v-if="pipelineStatus?.current" class="hint">Running {{ pipelineStatus.current }}…</p>
      <p v-if="!pipelineStatus?.recent.length" class="hint">Nothing since the app started.</p>
      <ul class="items">
        <li v-for="run in pipelineStatus?.recent ?? []" :key="run.at + run.template" class="item">
          <div class="what small">
            <span>{{ run.pipeline }}: {{ run.template }} for {{ run.logLabel }}</span>
            <a v-if="run.reportId" href="#" @click.prevent="go({ tab: 'reports', report: run.reportId })">Open the report</a>
            <span v-else class="error-text">{{ run.problem }}</span>
          </div>
        </li>
      </ul>
    </section>
  </template>

</template>

<style scoped>
.tabs {
  display: flex;
  gap: 6px;
  width: 100%;
  max-width: 1100px;
}

.tab {
  padding: 6px 14px;
  border: 1px solid rgba(127, 127, 127, 0.5);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.tab[aria-current='page'] {
  border-color: #2a78d6;
  background: color-mix(in srgb, #2a78d6 18%, transparent);
}

.card.wide {
  max-width: 1100px;
}

.pick {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 200px;
}

select,
input:not([type='checkbox']) {
  padding: 5px 8px;
  border: 1px solid rgba(127, 127, 127, 0.6);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
}

select option {
  background: var(--tile-background-color, Canvas);
}

.search {
  width: 100%;
  box-sizing: border-box;
}

.card-filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
}

.card-filter .search {
  flex: 1 1 240px;
  width: auto;
}

/* Choices as pills: orange when on, with a tick, and the box itself hidden
   (still there for the keyboard and screen readers). */
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  position: relative;
  display: inline-flex;
  cursor: pointer;
}

.chip input {
  position: absolute;
  opacity: 0;
  width: 1px;
  height: 1px;
}

.chip span {
  padding: 5px 12px;
  border: 1px solid rgba(127, 127, 127, 0.5);
  border-radius: 999px;
  font-size: 0.9rem;
  transition: background 120ms, border-color 120ms;
  user-select: none;
}

.chip:hover span {
  background: rgba(127, 127, 127, 0.1);
}

.chip input:checked + span {
  border-color: var(--md-sys-color-primary);
  background: color-mix(in srgb, var(--md-sys-color-primary) 20%, transparent);
  font-weight: 600;
}

.chip input:checked + span::before {
  content: '✓ ';
}

.chip input:focus-visible + span {
  outline: 2px solid var(--md-sys-color-primary);
  outline-offset: 2px;
}

.pick-box {
  flex: none;
  width: 18px;
  height: 18px;
  margin: 2px 0 0;
  accent-color: var(--md-sys-color-primary);
  cursor: pointer;
}

.pick-all {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

fieldset {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  border: none;
}

.auto-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.auto-head h2 {
  margin: 0;
  margin-right: auto;
}

.on-text {
  font-weight: 600;
}

/* The On switch: orange when on, grey when off. */
.on-switch {
  --md-switch-selected-track-color: #e8710a;
  --md-switch-selected-hover-track-color: #e8710a;
  --md-switch-selected-focus-track-color: #e8710a;
  --md-switch-selected-pressed-track-color: #e8710a;
  --md-switch-selected-handle-color: #fff;
  --md-switch-selected-hover-handle-color: #fff;
  --md-switch-selected-focus-handle-color: #fff;
  --md-switch-selected-pressed-handle-color: #fff;
  --md-switch-selected-icon-color: #e8710a;
  --md-switch-track-color: #9aa0a8;
  --md-switch-hover-track-color: #9aa0a8;
  --md-switch-focus-track-color: #9aa0a8;
  --md-switch-pressed-track-color: #9aa0a8;
  --md-switch-track-outline-color: #9aa0a8;
  --md-switch-handle-color: #fff;
  --md-switch-hover-handle-color: #fff;
  --md-switch-focus-handle-color: #fff;
  --md-switch-pressed-handle-color: #fff;
}

/* The list of logs and a log on its own use the page's whole width. */
.card.full {
  max-width: none;
}

.log-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.card-name {
  font-weight: 700;
}

.crumbs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.log-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px;
}

.log-head h2 {
  margin: 0;
}

.log-reports,
.problems {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.log-reports li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 6px;
  border-bottom: 1px solid rgba(127, 127, 127, 0.2);
}

.problems li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  padding: 4px 0;
}

.dot {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.log-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid rgba(127, 127, 127, 0.35);
  border-radius: 10px;
}

.log-card.gone {
  border-style: dashed;
}

.log-card header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.card-title {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.make-missing {
  flex: none;
  --md-outlined-button-container-height: 32px;
  --md-outlined-button-leading-space: 12px;
  --md-outlined-button-trailing-space: 12px;
}

.card-reports {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin: 0;
  padding: 0;
  list-style: none;
}



.items {
  margin: 0;
  padding: 0;
  list-style: none;
}

.item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 0;
  border-top: 1px solid rgba(127, 127, 127, 0.2);
}

.what {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.run {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}

.run select {
  max-width: 340px;
}

.link {
  padding: 0;
  border: none;
  background: none;
  color: var(--link-color);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.link:disabled {
  opacity: 0.45;
}

.clickable {
  cursor: pointer;
}

.clickable:hover {
  background: rgba(127, 127, 127, 0.08);
}

.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

fieldset {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  border: none;
}

.check {
  display: flex;
  align-items: center;
  gap: 6px;
}

.add-robot {
  display: flex;
  gap: 6px;
  align-items: center;
}

.small {
  font-size: 0.85rem;
}
</style>

<style>
/* Saving a report as a PDF prints the page: only the report. */
@media print {
  .nav,
  .no-print {
    display: none !important;
  }

  .main-content {
    margin-top: 0 !important;
    padding: 0 !important;
  }

  .card {
    box-shadow: none !important;
    max-width: none !important;
  }
}
</style>
