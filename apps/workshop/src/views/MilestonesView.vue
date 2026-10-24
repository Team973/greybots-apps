<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import AppDialog from '@greybots/common/components/AppDialog.vue';
import { errorMessage } from '@/lib/db';
import { formatDate } from '@/lib/dates';
import { burnup, milestoneProgress } from '@/lib/milestones';
import { fetchTickets, type Ticket } from '@/lib/tickets';
import { useAuthStore } from '@/stores/auth-store';
import { useDirectoryStore, type Milestone } from '@/stores/directory-store';

// The milestones, each with how far along it is and when it's forecast to be
// done. Leads and admins add them here; the milestone's own page has its
// burnup and moves tickets in and out.
const auth = useAuthStore();
const directory = useDirectoryStore();

const tickets = ref<Ticket[]>([]);
const loaded = ref(false);
const error = ref('');
const showClosed = ref(false);

async function load() {
  error.value = '';
  try {
    await directory.loadMilestones();
    tickets.value = await fetchTickets({ status: 'all' });
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loaded.value = true;
  }
}
onMounted(load);

const rows = computed(() =>
  directory.milestones
    .filter((m) => showClosed.value || !m.closed_at)
    .map((milestone) => {
      const own = tickets.value.filter((t) => t.milestone_id === milestone.id);
      return { milestone, progress: milestoneProgress(own), forecast: burnup(own, milestone.created_at).forecast };
    })
);
const closedCount = computed(() => directory.milestones.filter((m) => m.closed_at).length);
const unsorted = computed(() => tickets.value.filter((t) => !t.milestone_id && t.status !== 'closed').length);

// --- Adding ---
const adding = ref(false);
const draft = ref({ name: '', description: '', target_date: '' });
const saving = ref(false);
const dialogError = ref('');
function openAdd() {
  draft.value = { name: '', description: '', target_date: '' };
  dialogError.value = '';
  adding.value = true;
}
async function add() {
  dialogError.value = '';
  saving.value = true;
  try {
    await directory.saveMilestone({ name: draft.value.name, description: draft.value.description, target_date: draft.value.target_date || null } as Partial<Milestone> & { name: string });
    adding.value = false;
  } catch (e) {
    dialogError.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1>Milestones</h1>
      <button v-if="auth.isLead" class="button primary" @click="openAdd">New milestone</button>
    </header>
    <p v-if="error" class="error-text">{{ error }}</p>
    <p v-if="!loaded" class="empty">Loading…</p>

    <template v-else>
      <ul v-if="rows.length" class="milestones viz-root">
        <li v-for="{ milestone, progress, forecast } in rows" :key="milestone.id">
          <RouterLink :to="`/milestones/${milestone.id}`" class="panel milestone">
            <div class="panel-header">
              <h2>{{ milestone.name }}</h2>
              <span v-if="milestone.closed_at" class="chip">Closed</span>
              <span v-else-if="milestone.target_date" class="muted">Target {{ formatDate(milestone.target_date) }}</span>
            </div>
            <div class="meter" role="meter" :aria-valuenow="progress.done" aria-valuemin="0" :aria-valuemax="progress.scope" :aria-label="`${milestone.name} progress`">
              <span class="fill" :style="{ width: `${progress.fraction * 100}%` }"></span>
            </div>
            <div class="numbers">
              <span><strong>{{ progress.done }}</strong> of {{ progress.scope }} done</span>
              <span v-if="!milestone.closed_at && forecast" class="muted" :class="{ late: milestone.target_date && forecast > milestone.target_date }">
                Forecast {{ formatDate(forecast) }}
              </span>
            </div>
          </RouterLink>
        </li>
      </ul>
      <p v-else class="empty">No milestones yet.<template v-if="auth.isLead"> Add one to start grouping tickets.</template></p>

      <div class="footer">
        <RouterLink v-if="unsorted" to="/tickets?milestone=none" class="text-link">{{ unsorted }} open {{ unsorted === 1 ? 'ticket has' : 'tickets have' }} no milestone</RouterLink>
        <button v-if="closedCount" class="text-link" @click="showClosed = !showClosed">{{ showClosed ? 'Hide' : 'Show' }} {{ closedCount }} closed</button>
      </div>
    </template>

    <AppDialog :open="adding" title="New milestone" @close="adding = false">
      <form id="milestone-form" class="form-grid" @submit.prevent="add">
        <label class="field full">
          <span>Name</span>
          <input v-model="draft.name" type="text" maxlength="100" placeholder="e.g. Drivetrain done" required />
        </label>
        <label class="field full">
          <span>Description</span>
          <textarea v-model="draft.description" rows="3"></textarea>
        </label>
        <label class="field">
          <span>Target date</span>
          <input v-model="draft.target_date" type="date" />
        </label>
      </form>
      <p v-if="dialogError" class="error-text">{{ dialogError }}</p>
      <template #actions>
        <button class="button" @click="adding = false">Cancel</button>
        <button type="submit" form="milestone-form" class="button primary" :disabled="saving || !draft.name.trim()">Add</button>
      </template>
    </AppDialog>
  </div>
</template>

<style scoped>
.milestones {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.milestone {
  color: inherit;
  text-decoration: none;
}

.milestone:hover {
  box-shadow: inset 0 0 0 1px var(--header-color);
}

.meter {
  height: 10px;
  border-radius: 999px;
  background: rgba(128, 128, 128, 0.22);
  overflow: hidden;
}

.fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--viz-series-2);
}

.numbers {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 12px;
  font-size: 0.9rem;
}

.late {
  color: #d0711a;
  opacity: 1;
}

.footer {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}
</style>
