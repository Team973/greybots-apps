<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import AppDialog from '@greybots/common/components/AppDialog.vue';
import AddChecklistDialog from '@/components/AddChecklistDialog.vue';
import ChecklistRow from '@/components/ChecklistRow.vue';
import EditableField from '@/components/EditableField.vue';
import NewTicketDialog from '@/components/NewTicketDialog.vue';
import PeoplePicker from '@/components/PeoplePicker.vue';
import TicketRow from '@/components/TicketRow.vue';
import { fetchSessionChecklists, type FullChecklist } from '@/lib/checklists';
import { errorMessage } from '@/lib/db';
import { formatSessionTime } from '@/lib/dates';
import {
  addToPlan,
  fetchNeighbors,
  fetchPlan,
  fetchSession,
  removeFromPlan,
  reorderPlan,
  seedPlan,
  updateSession,
  type PlanItem,
  type Session
} from '@/lib/sessions';
import { fetchTickets, fetchTicketsByIds, isInterested, type Ticket } from '@/lib/tickets';
import { useAuthStore } from '@/stores/auth-store';
import { useDirectoryStore } from '@/stores/directory-store';

// A session's plan: the tickets to work on. It starts as the previous
// session's unfinished tickets (carried over automatically the first time
// anyone opens it), and leads and admins add, remove, and reorder from
// there, like planning a one-session sprint. Leads also add checklists to it
// (copies of the team's checklist templates, each with an owner). The
// session's details sit in a sidebar, like a ticket's: leads click the shop
// boss to change it, and the change saves straight away.
const auth = useAuthStore();
const directory = useDirectoryStore();
const route = useRoute();

const session = ref<Session | null>(null);
const neighbors = ref<{ previous: Session | null; next: Session | null }>({ previous: null, next: null });
const plan = ref<PlanItem[]>([]);
const tickets = ref<Map<string, Ticket>>(new Map());
const checklists = ref<FullChecklist[]>([]);
const loaded = ref(false);
const error = ref('');
const notice = ref('');
const busy = ref(false);

async function load() {
  error.value = '';
  notice.value = '';
  loaded.value = false;
  try {
    const id = route.params.id as string;
    let found = await fetchSession(id);
    if (found && !found.plan_seeded) {
      const added = await seedPlan(found.id);
      if (added) notice.value = `${added} unfinished ${added === 1 ? 'ticket was' : 'tickets were'} carried over from the previous session.`;
      found = await fetchSession(id);
    }
    session.value = found;
    if (found) {
      neighbors.value = await fetchNeighbors(found);
      await loadPlan();
    }
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loaded.value = true;
  }
}

async function loadPlan() {
  if (!session.value) return;
  const [items, lists] = await Promise.all([fetchPlan(session.value.id), fetchSessionChecklists(session.value.id)]);
  plan.value = items;
  checklists.value = lists;
  const found = await fetchTicketsByIds(plan.value.map((p) => p.ticket_id));
  tickets.value = new Map(found.map((t) => [t.id, t]));
}
watch(() => route.params.id, load, { immediate: true });

const planned = computed(() => plan.value.map((item) => ({ item, ticket: tickets.value.get(item.ticket_id) })).filter((p): p is { item: PlanItem; ticket: Ticket } => !!p.ticket));
const doneCount = computed(() => planned.value.filter((p) => p.ticket.status === 'closed').length);
const mineCount = computed(() => planned.value.filter((p) => isInterested(p.ticket, auth.userId)).length);
const past = computed(() => !!session.value && Date.parse(session.value.ends_at) < Date.now());

async function act(action: () => Promise<unknown>) {
  error.value = '';
  busy.value = true;
  try {
    await action();
    await loadPlan();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

const remove = (ticket: Ticket) => act(() => removeFromPlan(session.value!.id, ticket.id));

function move(index: number, by: number) {
  const ids = planned.value.map((p) => p.ticket.id);
  const [moved] = ids.splice(index, 1);
  ids.splice(index + by, 0, moved);
  return act(() => reorderPlan(session.value!.id, ids));
}

function pullFromPrevious() {
  return act(async () => {
    const added = await seedPlan(session.value!.id, true);
    notice.value = added ? `Added ${added} unfinished ${added === 1 ? 'ticket' : 'tickets'} from the previous session.` : 'Everything unfinished from the previous session is already in this plan.';
  });
}

// --- Adding tickets ---
const picking = ref(false);
const candidates = ref<Ticket[]>([]);
const chosen = ref<Set<string>>(new Set());
const search = ref('');

async function openPicker() {
  picking.value = true;
  chosen.value = new Set();
  search.value = '';
  try {
    candidates.value = await fetchTickets({ status: 'active' });
  } catch (e) {
    error.value = errorMessage(e);
  }
}

const inPlan = computed(() => new Set(plan.value.map((p) => p.ticket_id)));
const shownCandidates = computed(() => {
  const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return candidates.value
    .filter((t) => !inPlan.value.has(t.id))
    .filter((t) => {
      const text = `#${t.number} ${t.title} ${directory.milestone(t.milestone_id)?.name ?? ''} ${[t.owner_id, ...t.assignee_ids].map((id) => directory.personName(id)).join(' ')}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
});

function toggle(id: string) {
  const next = new Set(chosen.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  chosen.value = next;
}

function addChosen() {
  const ids = candidates.value.filter((t) => chosen.value.has(t.id)).map((t) => t.id);
  const last = Math.max(0, ...plan.value.map((p) => p.sort_order));
  picking.value = false;
  return act(() => addToPlan(session.value!.id, ids, last));
}

// Checklists on this session.
const addingChecklist = ref(false);
const signedOffCount = computed(() => checklists.value.filter((c) => c.signed_off_at).length);

// --- Details (the sidebar) ---
const editingBoss = ref(false);
const savingBoss = ref(false);
async function saveBoss(ids: string[]) {
  const current = session.value;
  editingBoss.value = false;
  if (!current) return;
  const shop_boss = ids[0] ?? null;
  if (shop_boss === current.shop_boss) return;
  error.value = '';
  savingBoss.value = true;
  try {
    await updateSession(current.id, { shop_boss });
    if (session.value?.id === current.id) session.value = { ...session.value, shop_boss };
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    savingBoss.value = false;
  }
}
watch(() => route.params.id, () => (editingBoss.value = false));

// A ticket opened from here goes straight into the plan.
const creating = ref(false);
function onCreated(ticket: Ticket) {
  const last = Math.max(0, ...plan.value.map((p) => p.sort_order));
  return act(() => addToPlan(session.value!.id, [ticket.id], last));
}
</script>

<template>
  <div class="page session-page">
    <div class="layout">
      <div class="main">
        <RouterLink to="/sessions" class="back">← Sessions</RouterLink>
        <p v-if="error" class="error-text">{{ error }}</p>
        <p v-if="!loaded" class="empty">Loading…</p>
        <p v-else-if="!session" class="empty">That session doesn't exist (it may have been cancelled).</p>

        <template v-else>
          <header class="page-header">
            <h1>{{ session.title }}</h1>
            <nav class="neighbors" aria-label="Other sessions">
              <RouterLink v-if="neighbors.previous" :to="`/sessions/${neighbors.previous.id}`" class="button small">← Previous</RouterLink>
              <RouterLink v-if="neighbors.next" :to="`/sessions/${neighbors.next.id}`" class="button small">Next →</RouterLink>
            </nav>
            <p class="hint">{{ formatSessionTime(session.starts_at, session.ends_at) }}{{ past ? ' · finished' : '' }}</p>
          </header>
          <p v-if="session.notes" class="notes">{{ session.notes }}</p>
          <p v-if="notice" class="success-text">{{ notice }}</p>

          <section class="panel">
            <div class="panel-header">
              <h2>Plan</h2>
              <span class="muted">{{ doneCount }} of {{ planned.length }} done<template v-if="mineCount"> · {{ mineCount }} yours</template></span>
            </div>
            <div v-if="auth.isLead" class="plan-actions">
              <button class="button small" :disabled="busy" @click="openPicker">Add tickets</button>
              <button class="button small" :disabled="busy" @click="creating = true">New ticket</button>
              <button class="button small" :disabled="busy" @click="pullFromPrevious">Pull in unfinished from the previous session</button>
            </div>

            <ul v-if="planned.length" class="ticket-list">
              <TicketRow v-for="({ ticket, item }, index) in planned" :key="ticket.id" :ticket="ticket">
                <template v-if="item.carried_over || auth.isLead" #actions>
                  <span v-if="item.carried_over" class="chip" title="Carried over from the previous session">Carried over</span>
                  <template v-if="auth.isLead">
                    <button class="icon-small" :disabled="busy || index === 0" aria-label="Move up" @click="move(index, -1)">↑</button>
                    <button class="icon-small" :disabled="busy || index === planned.length - 1" aria-label="Move down" @click="move(index, 1)">↓</button>
                    <button class="icon-small" :disabled="busy" :aria-label="`Remove #${ticket.number} from the plan`" @click="remove(ticket)">×</button>
                  </template>
                </template>
              </TicketRow>
            </ul>
            <p v-else class="empty">
              Nothing planned yet.<template v-if="auth.isLead"> Add tickets to set the goals for this session.</template>
            </p>
          </section>

          <section v-if="checklists.length || auth.isLead" class="panel">
            <div class="panel-header">
              <h2>Checklists</h2>
              <span v-if="checklists.length" class="muted">{{ signedOffCount }} of {{ checklists.length }} signed off</span>
            </div>
            <div v-if="auth.isLead" class="plan-actions">
              <button class="button small" :disabled="busy" @click="addingChecklist = true">Add checklist</button>
            </div>
            <ul v-if="checklists.length" class="ticket-list">
              <ChecklistRow v-for="checklist in checklists" :key="checklist.id" :checklist="checklist" />
            </ul>
            <p v-else class="empty">No checklists on this session. Add one of the team's checklists, with an owner who hands out its steps.</p>
          </section>
        </template>
      </div>

      <aside v-if="loaded && session" class="side panel" aria-label="Details">
        <dl class="details">
          <div>
            <dt>Shop boss</dt>
            <dd>
              <EditableField
                label="shop boss"
                :editable="auth.isLead"
                :open="editingBoss"
                @open="editingBoss = true"
                @close="editingBoss = false"
                @cancel="editingBoss = false"
              >
                {{ session.shop_boss ? directory.personName(session.shop_boss) : 'Nobody yet' }}<span v-if="savingBoss" class="muted"> · saving…</span>
                <template #editor>
                  <PeoplePicker single label="Shop boss" :model-value="session.shop_boss ? [session.shop_boss] : []" @update:model-value="saveBoss" />
                </template>
              </EditableField>
            </dd>
          </div>
          <div>
            <dt>When</dt>
            <dd>{{ formatSessionTime(session.starts_at, session.ends_at) }}{{ past ? ' · finished' : '' }}</dd>
          </div>
          <div>
            <dt>Plan</dt>
            <dd>{{ doneCount }} of {{ planned.length }} {{ planned.length === 1 ? 'ticket' : 'tickets' }} done</dd>
          </div>
          <div v-if="checklists.length">
            <dt>Checklists</dt>
            <dd>{{ signedOffCount }} of {{ checklists.length }} signed off</dd>
          </div>
        </dl>
      </aside>
    </div>

    <AppDialog :open="picking" title="Add tickets to the plan" @close="picking = false">
      <input v-model="search" class="control" type="search" placeholder="Search by title, person, or milestone" aria-label="Search tickets" />
      <ul class="picker">
        <li v-for="ticket in shownCandidates" :key="ticket.id">
          <label>
            <input type="checkbox" :checked="chosen.has(ticket.id)" @change="toggle(ticket.id)" />
            <span>
              <span><span class="muted">#{{ ticket.number }}</span> {{ ticket.title }}</span>
              <small class="muted">{{ [ticket.owner_id, ...ticket.assignee_ids].filter(Boolean).map((id) => directory.personName(id)).join(', ') || 'Unassigned' }}</small>
            </span>
          </label>
        </li>
        <li v-if="!shownCandidates.length" class="empty">No open tickets to add.</li>
      </ul>
      <template #actions>
        <button class="button" @click="picking = false">Cancel</button>
        <button class="button primary" :disabled="!chosen.size" @click="addChosen">Add {{ chosen.size || '' }}</button>
      </template>
    </AppDialog>

    <NewTicketDialog :open="creating" @close="creating = false" @created="onCreated" />
    <AddChecklistDialog v-if="session" :open="addingChecklist" :session-id="session.id" @close="addingChecklist = false" @added="act(async () => {})" />
  </div>
</template>

<style scoped>
/* The session in a centred middle column, its details on the right (as on
   the ticket page). */
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 720px) minmax(260px, 1fr);
  gap: 24px;
  align-items: start;
}

.main {
  grid-column: 2;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.side {
  grid-column: 3;
  max-width: 340px;
  margin-top: 40px;
}

@media (max-width: 1100px) {
  .layout {
    grid-template-columns: minmax(0, 1fr) 260px;
  }

  .main {
    grid-column: 1;
  }

  .side {
    grid-column: 2;
  }
}

@media (max-width: 720px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .main,
  .side {
    grid-column: 1;
    max-width: none;
    margin-top: 0;
  }
}

.details {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin: 0;
}

.details dt {
  margin-bottom: 4px;
  font-size: 0.8rem;
  opacity: 0.7;
}

.details dd {
  margin: 0;
}

.neighbors {
  display: flex;
  gap: 6px;
}

.notes {
  margin: 0;
  white-space: pre-wrap;
}

.plan-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ticket-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
}

.icon-small {
  flex: none;
  width: 30px;
  height: 30px;
  border: 1px solid var(--accent-color);
  border-radius: 6px;
  background: transparent;
  color: var(--primary-text-color);
  font: inherit;
  cursor: pointer;
}

.icon-small:disabled {
  opacity: 0.3;
  cursor: default;
}

.picker {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 50vh;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.picker label {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 6px 4px;
  border-radius: 6px;
  cursor: pointer;
}

.picker label:hover {
  background: rgba(128, 128, 128, 0.12);
}

.picker label > span {
  display: flex;
  flex-direction: column;
}
</style>
