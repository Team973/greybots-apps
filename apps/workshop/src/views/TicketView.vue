<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import CloseTicketDialog from '@/components/CloseTicketDialog.vue';
import ComponentChips from '@/components/ComponentChips.vue';
import EditableField from '@/components/EditableField.vue';
import PeoplePicker from '@/components/PeoplePicker.vue';
import { errorMessage, unwrap } from '@/lib/db';
import { formatDate, formatSessionTime, formatTime } from '@/lib/dates';
import { addToPlan, fetchPlan, fetchSessions, removeFromPlan, type Session } from '@/lib/sessions';
import {
  closeReasonLabels,
  fetchTicket,
  isOverdue,
  reopenTicket,
  statusLabels,
  statusText,
  updateTicketFields,
  type Ticket,
  type TicketDraft
} from '@/lib/tickets';
import { supabase } from '@greybots/common/supabase/client';
import { useAuthStore } from '@/stores/auth-store';
import { useDirectoryStore } from '@/stores/directory-store';

// One ticket: the title, description and shop sessions in the middle, and
// its details down the right. Members and above edit it a field at a time,
// by clicking the field, while it's open (a closed ticket can still be moved
// to another milestone). Leads and admins close and reopen it. There are no
// comments on purpose: Workshop is a plan, not a chat. Leads and admins also
// add an open ticket to upcoming shop sessions' plans, or take it off them.
const auth = useAuthStore();
const directory = useDirectoryStore();
const route = useRoute();

const ticket = ref<Ticket | null>(null);
const sessions = ref<Session[]>([]);
// Sessions in the next few months, to add the ticket to.
const upcoming = ref<Session[]>([]);
const loaded = ref(false);
const error = ref('');
const closing = ref(false);

async function load() {
  error.value = '';
  loaded.value = false;
  editing.value = null;
  try {
    const number = Number(route.params.number);
    const found = await fetchTicket(number);
    ticket.value = found;
    if (found) await loadExtras(found);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loaded.value = true;
  }
}

async function loadExtras(found: Ticket) {
  const plan = unwrap(
    await supabase.from('WorkshopSessionTicket').select('session:WorkshopSession(*)').eq('ticket_id', found.id)
  ) as unknown as { session: Session }[];
  sessions.value = plan.map((p) => p.session).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const now = new Date();
  upcoming.value = await fetchSessions(now.toISOString(), new Date(now.getTime() + 120 * 86_400_000).toISOString());
}

// --- Shop sessions (leads and admins) ---

const canPlan = computed(() => auth.isLead && ticket.value?.status !== 'closed');
const addable = computed(() => upcoming.value.filter((u) => !sessions.value.some((s) => s.id === u.id)));
const isUpcoming = (session: Session) => Date.parse(session.ends_at) > Date.now();
const planBusy = ref(false);
async function changePlan(action: () => Promise<unknown>) {
  error.value = '';
  planBusy.value = true;
  try {
    await action();
    await loadExtras(ticket.value!);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    planBusy.value = false;
  }
}
// At the end of that session's plan.
function addToSession(event: Event) {
  const select = event.target as HTMLSelectElement;
  const sessionId = select.value;
  select.value = '';
  if (!sessionId) return;
  return changePlan(async () => {
    const plan = await fetchPlan(sessionId);
    await addToPlan(sessionId, [ticket.value!.id], Math.max(0, ...plan.map((p) => p.sort_order)));
  });
}
const removeFromSession = (session: Session) => changePlan(() => removeFromPlan(session.id, ticket.value!.id));

const canEdit = computed(() => auth.isMember && ticket.value?.status !== 'closed');
// The database lets a closed ticket change milestone, too.
const canMove = computed(() => auth.isMember);

// --- Editing a field at a time ---

type Field = 'title' | 'description' | 'status' | 'components' | 'owner' | 'assignees' | 'due' | 'milestone';
const editing = ref<Field | null>(null);
// What the open field's editor holds.
const draft = ref<Partial<TicketDraft>>({});
const saving = ref(false);

watch(() => route.params.number, load, { immediate: true });

function open(field: Field) {
  const t = ticket.value!;
  editing.value = field;
  draft.value = {
    title: t.title,
    description: t.description,
    status: t.status === 'closed' ? 'open' : t.status,
    component_ids: [...t.component_ids],
    owner_id: t.owner_id,
    assignee_ids: [...t.assignee_ids],
    due_date: t.due_date,
    milestone_id: t.milestone_id
  };
}

// Saves run one after another, each on the ticket as the last one left it.
let queue = Promise.resolve();
function save(changes: Partial<TicketDraft>) {
  error.value = '';
  saving.value = true;
  queue = queue
    .then(async () => {
      ticket.value = await updateTicketFields(ticket.value!, changes);
    })
    .catch((e) => {
      error.value = errorMessage(e);
    })
    .finally(() => {
      saving.value = false;
    });
  return queue;
}

// Fields that save as they change (selects, dates, pickers) just close; the
// text fields save what was typed when they close, unless it's unchanged.
function close() {
  const field = editing.value;
  const t = ticket.value;
  editing.value = null;
  if (!t) return;
  if (field === 'title' && draft.value.title !== undefined && draft.value.title.trim() !== t.title) {
    if (draft.value.title.trim()) save({ title: draft.value.title });
    else error.value = 'A ticket needs a title.';
  }
  if (field === 'description' && draft.value.description !== undefined && draft.value.description.trim() !== t.description) {
    save({ description: draft.value.description });
  }
}
const cancel = () => (editing.value = null);

function saveAndClose(changes: Partial<TicketDraft>) {
  editing.value = null;
  save(changes);
}
function onAssignees(ids: string[]) {
  draft.value.assignee_ids = ids;
  save({ assignee_ids: ids });
}
function onComponents(ids: string[]) {
  draft.value.component_ids = ids;
  save({ component_ids: ids });
}

// --- Closing and reopening ---

async function onClosed(closed: Ticket) {
  ticket.value = closed;
  editing.value = null;
  await loadExtras(closed);
}

async function reopen() {
  if (!ticket.value) return;
  error.value = '';
  try {
    ticket.value = await reopenTicket(ticket.value);
  } catch (e) {
    error.value = errorMessage(e);
  }
}

const milestone = computed(() => directory.milestone(ticket.value?.milestone_id));
const milestoneChoices = computed(() => directory.milestones.filter((m) => !m.closed_at || m.id === ticket.value?.milestone_id));
const when = (iso: string) => `${formatDate(iso)}, ${formatTime(iso)}`;
</script>

<template>
  <div class="page ticket-page">
    <div class="layout">
      <div class="main">
        <RouterLink to="/tickets" class="back">← Tickets</RouterLink>
        <p v-if="error" class="error-text">{{ error }}</p>
        <p v-if="!loaded" class="empty">Loading…</p>
        <p v-else-if="!ticket" class="empty">There's no ticket #{{ route.params.number }}.</p>

        <template v-else>
          <header class="ticket-header">
            <EditableField class="title-field" label="title" :editable="canEdit" :open="editing === 'title'" @open="open('title')" @close="close" @cancel="cancel">
              <h1><span class="number">#{{ ticket.number }}</span> {{ ticket.title }}</h1>
              <template #editor>
                <input v-model="draft.title" class="title-input" type="text" maxlength="200" aria-label="Title" @keydown.enter.prevent="close" />
              </template>
            </EditableField>
            <div class="header-actions">
              <span v-if="saving" class="muted saving">Saving…</span>
              <button v-if="auth.isLead && ticket.status !== 'closed'" class="button primary" @click="closing = true">Close…</button>
              <button v-if="auth.isLead && ticket.status === 'closed'" class="button" @click="reopen">Reopen</button>
            </div>
          </header>

          <section class="panel">
            <div class="chips">
              <EditableField label="status" :editable="canEdit" :open="editing === 'status'" @open="open('status')" @close="close" @cancel="cancel">
                <span class="chip" :class="[`status-${ticket.status}`, ticket.close_reason ? `reason-${ticket.close_reason}` : '']">{{ statusText(ticket) }}</span>
                <template #editor>
                  <select v-model="draft.status" class="control" aria-label="Status" @change="saveAndClose({ status: draft.status })">
                    <option value="open">{{ statusLabels.open }}</option>
                    <option value="in_progress">{{ statusLabels.in_progress }}</option>
                  </select>
                </template>
              </EditableField>
              <span v-if="isOverdue(ticket)" class="chip overdue">Overdue</span>
              <EditableField
                class="components-field"
                label="components"
                :editable="canEdit"
                :open="editing === 'components'"
                @open="open('components')"
                @close="close"
                @cancel="cancel"
              >
                <ComponentChips v-if="ticket.component_ids.length" :model-value="ticket.component_ids" />
                <span v-else class="muted">No components</span>
                <template #editor>
                  <div class="editor-row">
                    <ComponentChips :model-value="draft.component_ids ?? []" editable @update:model-value="onComponents" />
                    <button type="button" class="button small" @click="cancel">Done</button>
                  </div>
                </template>
              </EditableField>
            </div>

            <EditableField label="description" :editable="canEdit" :open="editing === 'description'" @open="open('description')" @close="close" @cancel="cancel">
              <p v-if="ticket.description" class="description">{{ ticket.description }}</p>
              <p v-else class="empty">{{ canEdit ? 'Add a description' : 'No description.' }}</p>
              <template #editor>
                <textarea
                  v-model="draft.description"
                  class="description-input"
                  rows="8"
                  aria-label="Description"
                  placeholder="Details, links, what done looks like"
                  @keydown.ctrl.enter.prevent="close"
                  @keydown.meta.enter.prevent="close"
                ></textarea>
                <div class="editor-actions">
                  <button type="button" class="button small" @click="cancel">Cancel</button>
                  <button type="button" class="button small primary" @click="close">Save</button>
                </div>
              </template>
            </EditableField>
          </section>

          <section class="panel">
            <h2>Shop sessions</h2>
            <ul v-if="sessions.length" class="session-list">
              <li v-for="session in sessions" :key="session.id">
                <span>
                  <RouterLink :to="`/sessions/${session.id}`">{{ session.title }}</RouterLink>
                  <span class="muted"> · {{ formatSessionTime(session.starts_at, session.ends_at) }}</span>
                </span>
                <button
                  v-if="canPlan && isUpcoming(session)"
                  type="button"
                  class="button small"
                  :disabled="planBusy"
                  :aria-label="`Take off the plan for ${session.title}, ${formatSessionTime(session.starts_at, session.ends_at)}`"
                  @click="removeFromSession(session)"
                >
                  Remove
                </button>
              </li>
            </ul>
            <p v-else class="empty">Not planned for any session yet.</p>
            <select v-if="canPlan && addable.length" class="control add-session" aria-label="Add to a shop session" :disabled="planBusy" @change="addToSession">
              <option value="">Add to a session…</option>
              <option v-for="session in addable" :key="session.id" :value="session.id">
                {{ session.title }} · {{ formatSessionTime(session.starts_at, session.ends_at) }}
              </option>
            </select>
          </section>
        </template>
      </div>

      <aside v-if="loaded && ticket" class="side panel" aria-label="Details">
        <dl class="details">
          <div>
            <dt>Owner</dt>
            <dd>
              <EditableField label="owner" :editable="canEdit" :open="editing === 'owner'" @open="open('owner')" @close="close" @cancel="cancel">
                {{ directory.personName(ticket.owner_id) }}
                <template #editor>
                  <select v-model="draft.owner_id" class="control" aria-label="Owner" @change="saveAndClose({ owner_id: draft.owner_id })">
                    <option :value="null">Nobody</option>
                    <option v-for="person in directory.assignable" :key="person.user_id" :value="person.user_id">{{ person.name }}</option>
                  </select>
                </template>
              </EditableField>
            </dd>
          </div>
          <div>
            <dt>Assignees</dt>
            <dd>
              <EditableField label="assignees" :editable="canEdit" :open="editing === 'assignees'" @open="open('assignees')" @close="close" @cancel="cancel">
                {{ ticket.assignee_ids.length ? ticket.assignee_ids.map((id) => directory.personName(id)).join(', ') : 'Nobody' }}
                <template #editor>
                  <PeoplePicker :model-value="draft.assignee_ids ?? []" @update:model-value="onAssignees" />
                  <div class="editor-actions">
                    <button type="button" class="button small" @click="cancel">Done</button>
                  </div>
                </template>
              </EditableField>
            </dd>
          </div>
          <div>
            <dt>Estimated completion</dt>
            <dd>
              <EditableField label="estimated completion" :editable="canEdit" :open="editing === 'due'" @open="open('due')" @close="close" @cancel="cancel">
                <span :class="{ overdue: isOverdue(ticket) }">{{ ticket.due_date ? formatDate(ticket.due_date) : 'Not set' }}</span>
                <template #editor>
                  <div class="editor-row">
                    <input v-model="draft.due_date" class="control" type="date" aria-label="Estimated completion" @change="saveAndClose({ due_date: draft.due_date || null })" />
                    <button v-if="ticket.due_date" type="button" class="button small" @click="saveAndClose({ due_date: null })">Clear</button>
                  </div>
                </template>
              </EditableField>
            </dd>
          </div>
          <div>
            <dt>Milestone</dt>
            <dd>
              <EditableField label="milestone" :editable="canMove" :open="editing === 'milestone'" @open="open('milestone')" @close="close" @cancel="cancel">
                <RouterLink v-if="milestone" :to="`/milestones/${milestone.id}`" @click.stop>{{ milestone.name }}</RouterLink>
                <template v-else>None</template>
                <template #editor>
                  <select v-model="draft.milestone_id" class="control" aria-label="Milestone" @change="saveAndClose({ milestone_id: draft.milestone_id })">
                    <option :value="null">None</option>
                    <option v-for="m in milestoneChoices" :key="m.id" :value="m.id">{{ m.name }}</option>
                  </select>
                </template>
              </EditableField>
            </dd>
          </div>
          <div>
            <dt>Opened</dt>
            <dd>{{ formatDate(ticket.created_at) }} by {{ directory.personName(ticket.created_by) }}</dd>
          </div>
          <div>
            <dt>Last updated</dt>
            <dd>{{ when(ticket.updated_at) }}</dd>
          </div>
          <div v-if="ticket.status === 'closed' && ticket.closed_at">
            <dt>Closed</dt>
            <dd>
              {{ when(ticket.closed_at) }} by {{ directory.personName(ticket.closed_by) }}
              <template v-if="ticket.close_reason"> ({{ closeReasonLabels[ticket.close_reason] }})</template>
            </dd>
          </div>
        </dl>
      </aside>
    </div>

    <CloseTicketDialog v-if="ticket" :open="closing" :ticket="ticket" @close="closing = false" @closed="onClosed" />
  </div>
</template>

<style scoped>
/* The ticket in a centred middle column, its details on the right. */
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

.back {
  color: inherit;
  opacity: 0.75;
  text-decoration: none;
}

.ticket-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px 16px;
}

.title-field {
  flex: 1 1 320px;
}

.ticket-header h1 {
  margin: 0;
  overflow-wrap: anywhere;
}

.title-input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--accent-color);
  background: var(--background-color);
  color: var(--primary-text-color);
  font: inherit;
  font-size: 1.6rem;
  font-weight: 600;
}

.number {
  opacity: 0.55;
  font-weight: 400;
}

.header-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.saving {
  font-size: 0.85rem;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
}

.components-field {
  flex: 1 1 auto;
}

.description {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.description-input {
  width: 100%;
  box-sizing: border-box;
  min-height: 160px;
  padding: 8px 9px;
  border-radius: 6px;
  border: 1px solid var(--accent-color);
  background: var(--background-color);
  color: var(--primary-text-color);
  font: inherit;
  resize: vertical;
}

.editor-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
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

.details select,
.details input[type='date'] {
  width: 100%;
  box-sizing: border-box;
}

.details .editor-row input[type='date'] {
  width: auto;
  flex: 1 1 140px;
}

.details .overdue {
  color: #e5534b;
  font-weight: 600;
}

.details a,
.session-list a {
  color: var(--header-hover-color);
}

.session-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.session-list li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px 12px;
}

.add-session {
  align-self: flex-start;
  max-width: 100%;
}
</style>
