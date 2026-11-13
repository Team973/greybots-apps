<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import AppDialog from '@greybots/common/components/AppDialog.vue';
import BurnupChart from '@/components/BurnupChart.vue';
import ComponentChips from '@/components/ComponentChips.vue';
import ForecastSettingsFields from '@/components/ForecastSettingsFields.vue';
import { addChart, chartTickets, deleteChart, fetchCharts, reorderCharts, updateChart, type DashboardChart } from '@/lib/dashboard';
import { errorMessage } from '@/lib/db';
import { burnup, draftColumns, forecastDraft, forecastDraftProblem, milestoneProgress, type ForecastDraft } from '@/lib/milestones';
import { fetchForecastSessions, type Session } from '@/lib/sessions';
import { fetchTickets, type Ticket } from '@/lib/tickets';
import { useAuthStore } from '@/stores/auth-store';
import { useDirectoryStore, type Milestone } from '@/stores/directory-store';

// Burnup charts across the shop, each over the tickets its filter picks (some
// milestones, some components, or both). Everyone sees them; leads and admins
// add, edit, reorder, and remove them, and pick which forecasts each shows.
const auth = useAuthStore();
const directory = useDirectoryStore();

const charts = ref<DashboardChart[]>([]);
const tickets = ref<Ticket[]>([]);
const sessions = ref<Session[]>([]);
const loaded = ref(false);
const error = ref('');

async function load() {
  error.value = '';
  try {
    [charts.value, tickets.value, sessions.value] = await Promise.all([fetchCharts(), fetchTickets({ status: 'all' }), fetchForecastSessions()]);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loaded.value = true;
  }
}
onMounted(load);

const rows = computed(() =>
  charts.value.map((chart) => {
    const own = chartTickets(tickets.value, chart);
    return {
      chart,
      progress: milestoneProgress(own),
      data: burnup(own, chart, sessions.value),
      milestones: chart.milestone_ids.map((id) => directory.milestone(id)).filter((m): m is Milestone => !!m)
    };
  })
);

// --- Reordering ---
const busy = ref(false);
async function move(index: number, by: -1 | 1) {
  const next = [...charts.value];
  const [chart] = next.splice(index, 1);
  next.splice(index + by, 0, chart);
  charts.value = next;
  busy.value = true;
  try {
    await reorderCharts(next.map((c) => c.id));
  } catch (e) {
    error.value = errorMessage(e);
    await load();
  } finally {
    busy.value = false;
  }
}

// --- Adding and editing ---
const editingId = ref<string | null>(null);
const dialogOpen = ref(false);
const draft = ref({ title: '', milestone_ids: [] as string[], component_ids: [] as string[], target_date: '' });
const forecasts = ref<ForecastDraft>(forecastDraft({}));
const confirmingDelete = ref(false);
const dialogError = ref('');

function openChart(chart: DashboardChart | null) {
  editingId.value = chart?.id ?? null;
  draft.value = {
    title: chart?.title ?? '',
    milestone_ids: [...(chart?.milestone_ids ?? [])],
    component_ids: [...(chart?.component_ids ?? [])],
    target_date: chart?.target_date ?? ''
  };
  forecasts.value = forecastDraft(chart ?? {});
  confirmingDelete.value = false;
  dialogError.value = '';
  dialogOpen.value = true;
}

function toggleMilestone(id: string) {
  const ids = draft.value.milestone_ids;
  draft.value.milestone_ids = ids.includes(id) ? ids.filter((m) => m !== id) : [...ids, id];
}
// Open milestones first; closed ones stay pickable (a chart can look back).
const milestoneChoices = computed(() => [...directory.milestones].sort((a, b) => Number(!!a.closed_at) - Number(!!b.closed_at)));
const matching = computed(() => chartTickets(tickets.value, draft.value));
const matchingProgress = computed(() => milestoneProgress(matching.value));
const problem = computed(() => (!draft.value.title.trim() ? 'Give the chart a title.' : forecastDraftProblem(forecasts.value)));

async function run(action: () => Promise<unknown>) {
  dialogError.value = '';
  busy.value = true;
  try {
    await action();
    dialogOpen.value = false;
    await load();
  } catch (e) {
    dialogError.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
function save() {
  const chart = { ...draft.value, target_date: draft.value.target_date || null, ...draftColumns(forecasts.value) };
  return run(() =>
    editingId.value ? updateChart(editingId.value, chart) : addChart(chart, Math.max(0, ...charts.value.map((c) => c.sort_order)))
  );
}
const remove = () => run(() => deleteChart(editingId.value!));
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1>Dashboard</h1>
      <button v-if="auth.isLead" class="button primary" @click="openChart(null)">Add chart</button>
      <p class="hint">Burnup charts across milestones and components.</p>
    </header>
    <p v-if="error" class="error-text">{{ error }}</p>
    <p v-if="!loaded" class="empty">Loading…</p>

    <template v-else>
      <ul v-if="rows.length" class="charts">
        <li v-for="({ chart, progress, data, milestones }, i) in rows" :key="chart.id" class="panel">
          <div class="panel-header">
            <h2>{{ chart.title }}</h2>
            <div v-if="auth.isLead" class="chart-actions">
              <button class="button small" :disabled="busy || i === 0" :aria-label="`Move ${chart.title} up`" @click="move(i, -1)">↑</button>
              <button class="button small" :disabled="busy || i === rows.length - 1" :aria-label="`Move ${chart.title} down`" @click="move(i, 1)">↓</button>
              <button class="button small" @click="openChart(chart)">Edit</button>
            </div>
          </div>
          <div class="filter">
            <template v-if="!chart.milestone_ids.length && !chart.component_ids.length">All tickets</template>
            <template v-if="chart.milestone_ids.length">
              <span class="muted">{{ chart.milestone_ids.length === 1 ? 'Milestone' : 'Milestones' }}</span>
              <RouterLink v-for="m in milestones" :key="m.id" :to="`/milestones/${m.id}`" class="text-link">{{ m.name }}</RouterLink>
              <span v-if="milestones.length < chart.milestone_ids.length" class="muted">(and {{ chart.milestone_ids.length - milestones.length }} deleted)</span>
            </template>
            <template v-if="chart.component_ids.length">
              <span class="muted">{{ chart.component_ids.length === 1 ? 'Component' : 'Components' }}</span>
              <ComponentChips :model-value="chart.component_ids" />
            </template>
            <span class="muted count">· {{ progress.done }} of {{ progress.scope }} done</span>
          </div>
          <BurnupChart v-if="progress.scope" :data="data" :target-date="chart.target_date" title="" />
          <p v-else class="empty">No tickets match this chart yet.</p>
        </li>
      </ul>
      <p v-else class="empty">No charts yet.<template v-if="auth.isLead"> Add one to follow progress across milestones or components.</template></p>
    </template>

    <AppDialog :open="dialogOpen" :title="editingId ? 'Edit chart' : 'Add chart'" @close="dialogOpen = false">
      <form id="dashboard-chart-form" class="chart-form" @submit.prevent="save">
        <label class="field">
          <span>Title</span>
          <input v-model="draft.title" type="text" maxlength="100" placeholder="e.g. Drivetrain, all milestones" required />
        </label>

        <div class="field">
          <span>Milestones (none: all)</span>
          <div class="milestone-choices">
            <label v-for="m in milestoneChoices" :key="m.id" class="choice">
              <input type="checkbox" :checked="draft.milestone_ids.includes(m.id)" @change="toggleMilestone(m.id)" />
              {{ m.name }}<span v-if="m.closed_at" class="muted"> (closed)</span>
            </label>
            <span v-if="!milestoneChoices.length" class="muted">No milestones yet.</span>
          </div>
        </div>

        <div class="field">
          <span>Components (none: all)</span>
          <ComponentChips v-model="draft.component_ids" editable />
        </div>

        <label class="field">
          <span>Target date</span>
          <input v-model="draft.target_date" type="date" />
        </label>

        <p class="hint">{{ matchingProgress.scope }} {{ matchingProgress.scope === 1 ? 'ticket' : 'tickets' }} match</p>

        <ForecastSettingsFields v-model="forecasts" />
      </form>
      <p v-if="dialogError" class="error-text">{{ dialogError }}</p>
      <template #actions>
        <template v-if="editingId">
          <button v-if="!confirmingDelete" class="button danger" :disabled="busy" @click="confirmingDelete = true">Delete…</button>
          <button v-else class="button danger" :disabled="busy" @click="remove">Confirm: delete chart</button>
        </template>
        <span class="actions-spacer"></span>
        <button class="button" @click="dialogOpen = false">Cancel</button>
        <button type="submit" form="dashboard-chart-form" class="button primary" :disabled="busy || !!problem" :title="problem ?? undefined">
          {{ editingId ? 'Save' : 'Add' }}
        </button>
      </template>
    </AppDialog>
  </div>
</template>

<style scoped>
.charts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 520px), 1fr));
  gap: 16px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.chart-actions {
  display: flex;
  gap: 6px;
}

.filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  font-size: 0.9rem;
}

.chart-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chart-form > .field {
  flex: none;
}

.milestone-choices {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 180px;
  overflow-y: auto;
  padding: 6px 8px;
  border: 1px solid rgba(128, 128, 128, 0.35);
  border-radius: 6px;
}

.choice {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.95rem;
  opacity: 1;
}

.choice input {
  padding: 0;
  width: 18px;
  height: 18px;
  flex: none;
}
</style>
