<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import AppDialog from '@greybots/common/components/AppDialog.vue';
import BurnupChart from '@/components/BurnupChart.vue';
import NewTicketDialog from '@/components/NewTicketDialog.vue';
import TicketRow from '@/components/TicketRow.vue';
import { errorMessage } from '@/lib/db';
import { formatDate } from '@/lib/dates';
import { burnup, milestoneProgress } from '@/lib/milestones';
import { fetchTickets, moveTickets, type Ticket } from '@/lib/tickets';
import { useAuthStore } from '@/stores/auth-store';
import { useDirectoryStore } from '@/stores/directory-store';

// One milestone: its progress and burnup, and its tickets. Leads and admins
// edit it, close it, and move tickets to other milestones (tick some, then
// pick where they go).
const auth = useAuthStore();
const directory = useDirectoryStore();
const route = useRoute();
const router = useRouter();

const tickets = ref<Ticket[]>([]);
const loaded = ref(false);
const error = ref('');
const busy = ref(false);

const milestone = computed(() => directory.milestone(route.params.id as string));

async function load() {
  error.value = '';
  try {
    tickets.value = await fetchTickets({ status: 'all', milestoneId: route.params.id as string });
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loaded.value = true;
  }
}
watch(() => route.params.id, load, { immediate: true });

const progress = computed(() => milestoneProgress(tickets.value));
const chart = computed(() => (milestone.value ? burnup(tickets.value, milestone.value.created_at) : null));
const open = computed(() => tickets.value.filter((t) => t.status !== 'closed').sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')));
const closed = computed(() => tickets.value.filter((t) => t.status === 'closed'));

// --- Moving tickets ---
const selected = ref<Set<string>>(new Set());
const destination = ref<string>('');
function toggle(id: string) {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}
const allSelected = computed(() => open.value.length > 0 && open.value.every((t) => selected.value.has(t.id)));
function toggleAll() {
  selected.value = allSelected.value ? new Set() : new Set(open.value.map((t) => t.id));
}
const destinations = computed(() => directory.openMilestones.filter((m) => m.id !== milestone.value?.id));
async function moveSelected() {
  if (!selected.value.size || !destination.value) return;
  error.value = '';
  busy.value = true;
  try {
    await moveTickets([...selected.value], destination.value === 'none' ? null : destination.value);
    selected.value = new Set();
    destination.value = '';
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

// --- Editing ---
const editing = ref(false);
const draft = ref({ name: '', description: '', target_date: '' });
const confirmingDelete = ref(false);
const dialogError = ref('');
function startEdit() {
  if (!milestone.value) return;
  draft.value = { name: milestone.value.name, description: milestone.value.description, target_date: milestone.value.target_date ?? '' };
  confirmingDelete.value = false;
  dialogError.value = '';
  editing.value = true;
}
async function run(action: () => Promise<unknown>) {
  dialogError.value = '';
  busy.value = true;
  try {
    await action();
    editing.value = false;
  } catch (e) {
    dialogError.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
const saveEdit = () =>
  run(() => directory.saveMilestone({ ...milestone.value!, name: draft.value.name, description: draft.value.description, target_date: draft.value.target_date || null }));
const setClosed = (value: boolean) => run(() => directory.saveMilestone({ ...milestone.value!, closed_at: value ? new Date().toISOString() : null }));
// Its tickets stay, with no milestone.
const remove = () =>
  run(async () => {
    await directory.deleteMilestone(milestone.value!.id);
    router.replace('/milestones');
  });

const creating = ref(false);
</script>

<template>
  <div class="page">
    <RouterLink to="/milestones" class="back">← Milestones</RouterLink>
    <p v-if="error" class="error-text">{{ error }}</p>
    <p v-if="!milestone" class="empty">That milestone doesn't exist.</p>

    <template v-else>
      <header class="page-header">
        <h1>{{ milestone.name }}</h1>
        <div class="header-actions">
          <button v-if="auth.isMember && !milestone.closed_at" class="button" @click="creating = true">New ticket</button>
          <button v-if="auth.isLead" class="button" @click="startEdit">Edit</button>
        </div>
        <p class="hint">
          <template v-if="milestone.closed_at">Closed {{ formatDate(milestone.closed_at) }} · </template>
          <template v-if="milestone.target_date">Target {{ formatDate(milestone.target_date) }} · </template>
          {{ progress.done }} of {{ progress.scope }} done
        </p>
      </header>
      <p v-if="milestone.description" class="description">{{ milestone.description }}</p>

      <section v-if="chart && loaded" class="panel">
        <BurnupChart :data="chart" :target-date="milestone.target_date" />
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2>Open tickets ({{ open.length }})</h2>
          <label v-if="auth.isLead && open.length" class="select-all"><input type="checkbox" :checked="allSelected" @change="toggleAll" /> Select all</label>
        </div>
        <div v-if="auth.isLead && selected.size" class="move-bar">
          <span>{{ selected.size }} selected. Move to</span>
          <select v-model="destination" class="control" aria-label="Move to milestone">
            <option value="" disabled>Pick a milestone</option>
            <option v-for="m in destinations" :key="m.id" :value="m.id">{{ m.name }}</option>
            <option value="none">No milestone</option>
          </select>
          <button class="button small primary" :disabled="busy || !destination" @click="moveSelected">Move</button>
        </div>
        <ul v-if="open.length" class="ticket-list">
          <li v-for="ticket in open" :key="ticket.id" class="selectable">
            <input v-if="auth.isLead" type="checkbox" :checked="selected.has(ticket.id)" :aria-label="`Select #${ticket.number}`" @change="toggle(ticket.id)" />
            <ul class="row-wrap"><TicketRow :ticket="ticket" /></ul>
          </li>
        </ul>
        <p v-else-if="loaded" class="empty">No open tickets.</p>
      </section>

      <section v-if="closed.length" class="panel">
        <details>
          <summary><h2>Closed ({{ closed.length }})</h2></summary>
          <ul class="ticket-list closed-list">
            <TicketRow v-for="ticket in closed" :key="ticket.id" :ticket="ticket" />
          </ul>
        </details>
      </section>
    </template>

    <AppDialog :open="editing" title="Edit milestone" @close="editing = false">
      <form id="milestone-edit-form" class="form-grid" @submit.prevent="saveEdit">
        <label class="field full">
          <span>Name</span>
          <input v-model="draft.name" type="text" maxlength="100" required />
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
        <button v-if="!confirmingDelete" class="button danger" :disabled="busy" @click="confirmingDelete = true">Delete…</button>
        <button v-else class="button danger" :disabled="busy" @click="remove">Confirm: delete (tickets stay)</button>
        <button v-if="milestone && !milestone.closed_at" class="button" :disabled="busy" @click="setClosed(true)">Close milestone</button>
        <button v-else-if="milestone" class="button" :disabled="busy" @click="setClosed(false)">Reopen milestone</button>
        <span class="actions-spacer"></span>
        <button class="button" @click="editing = false">Cancel</button>
        <button type="submit" form="milestone-edit-form" class="button primary" :disabled="busy || !draft.name.trim()">Save</button>
      </template>
    </AppDialog>

    <NewTicketDialog v-if="milestone" :open="creating" :preset="{ milestone_id: milestone.id }" @close="creating = false" @created="load" />
  </div>
</template>

<style scoped>
.back {
  color: inherit;
  opacity: 0.75;
  text-decoration: none;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.description {
  margin: 0;
  white-space: pre-wrap;
}

.select-all {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.9rem;
}

.move-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(128, 128, 128, 0.12);
}

.ticket-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.closed-list {
  margin-top: 8px;
}

.selectable {
  display: flex;
  align-items: center;
  gap: 8px;
}

.selectable input {
  width: 18px;
  height: 18px;
  flex: none;
}

.row-wrap {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 0;
}

details summary {
  cursor: pointer;
}

details summary h2 {
  display: inline;
}
</style>
