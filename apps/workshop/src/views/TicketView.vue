<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import CloseTicketDialog from '@/components/CloseTicketDialog.vue';
import ComponentChips from '@/components/ComponentChips.vue';
import TicketForm from '@/components/TicketForm.vue';
import { errorMessage, unwrap } from '@/lib/db';
import { formatDate, formatSessionTime } from '@/lib/dates';
import { fetchTicketAwards, type PointAward } from '@/lib/points';
import type { Session } from '@/lib/sessions';
import { draftOf, fetchTicket, isOverdue, reopenTicket, statusText, updateTicket, type Ticket, type TicketDraft } from '@/lib/tickets';
import { supabase } from '@greybots/common/supabase/client';
import { useAuthStore } from '@/stores/auth-store';
import { useDirectoryStore } from '@/stores/directory-store';

// One ticket: everything about it, editing (members and above, while it's
// open), and closing or reopening (leads and admins). There are no comments
// on purpose: Workshop is a plan, not a chat.
const auth = useAuthStore();
const directory = useDirectoryStore();
const route = useRoute();

const ticket = ref<Ticket | null>(null);
const sessions = ref<Session[]>([]);
const awards = ref<PointAward[]>([]);
const loaded = ref(false);
const error = ref('');

const editing = ref(false);
const draft = ref<TicketDraft | null>(null);
const saving = ref(false);
const closing = ref(false);
const notice = ref('');

async function load() {
  error.value = '';
  loaded.value = false;
  editing.value = false;
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
  awards.value = found.status === 'closed' ? await fetchTicketAwards(found.id) : [];
}
watch(() => route.params.number, load, { immediate: true });

const canEdit = computed(() => auth.isMember && ticket.value?.status !== 'closed');

function startEdit() {
  if (!ticket.value) return;
  draft.value = draftOf(ticket.value);
  notice.value = '';
  editing.value = true;
}

async function save() {
  if (!ticket.value || !draft.value) return;
  error.value = '';
  saving.value = true;
  try {
    const hadBounty = draft.value.bounty;
    const saved = await updateTicket(ticket.value, draft.value);
    if (hadBounty && !saved.bounty) notice.value = 'The bounty was cleared: whoever set it is now on the ticket. Someone else needs to set it again.';
    ticket.value = saved;
    editing.value = false;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

async function onClosed(closed: Ticket) {
  ticket.value = closed;
  await loadExtras(closed);
}

async function reopen() {
  if (!ticket.value) return;
  error.value = '';
  try {
    ticket.value = await reopenTicket(ticket.value);
    awards.value = [];
  } catch (e) {
    error.value = errorMessage(e);
  }
}

const milestone = computed(() => directory.milestone(ticket.value?.milestone_id));
</script>

<template>
  <div class="page">
    <RouterLink to="/tickets" class="back">← Tickets</RouterLink>
    <p v-if="error" class="error-text">{{ error }}</p>
    <p v-if="!loaded" class="empty">Loading…</p>
    <p v-else-if="!ticket" class="empty">There's no ticket #{{ route.params.number }}.</p>

    <template v-else>
      <header class="page-header">
        <h1><span class="number">#{{ ticket.number }}</span> {{ ticket.title }}</h1>
        <div class="header-actions">
          <button v-if="canEdit && !editing" class="button" @click="startEdit">Edit</button>
          <button v-if="auth.isLead && ticket.status !== 'closed' && !editing" class="button primary" @click="closing = true">Close…</button>
          <button v-if="auth.isLead && ticket.status === 'closed'" class="button" @click="reopen">Reopen</button>
        </div>
      </header>
      <p v-if="notice" class="hint warning">{{ notice }}</p>

      <section v-if="editing && draft" class="panel">
        <form id="edit-ticket-form" @submit.prevent="save">
          <TicketForm v-model="draft" :bounty-set-by="ticket.bounty_set_by" />
        </form>
        <div class="form-actions">
          <button type="button" class="button" @click="editing = false">Cancel</button>
          <button type="submit" form="edit-ticket-form" class="button primary" :disabled="saving || !draft.title.trim()">{{ saving ? 'Saving…' : 'Save' }}</button>
        </div>
      </section>

      <template v-else>
        <section class="panel">
          <div class="meta">
            <span class="chip" :class="[`status-${ticket.status}`, ticket.close_reason ? `reason-${ticket.close_reason}` : '']">{{ statusText(ticket) }}</span>
            <span v-if="ticket.bounty" class="chip points">{{ ticket.bounty }} pts</span>
            <span v-if="isOverdue(ticket)" class="chip overdue">Overdue</span>
            <ComponentChips :model-value="ticket.component_ids" />
          </div>
          <p v-if="ticket.description" class="description">{{ ticket.description }}</p>
          <p v-else class="empty">No description.</p>

          <dl class="details">
            <dt>Owner</dt>
            <dd>{{ directory.personName(ticket.owner_id) }}</dd>
            <dt>Assignees</dt>
            <dd>{{ ticket.assignee_ids.length ? ticket.assignee_ids.map((id) => directory.personName(id)).join(', ') : 'Nobody' }}</dd>
            <dt>Estimated completion</dt>
            <dd>{{ ticket.due_date ? formatDate(ticket.due_date) : 'Not set' }}</dd>
            <dt>Milestone</dt>
            <dd>
              <RouterLink v-if="milestone" :to="`/milestones/${milestone.id}`">{{ milestone.name }}</RouterLink>
              <template v-else>None</template>
            </dd>
            <dt>Bounty</dt>
            <dd>
              <template v-if="ticket.bounty">{{ ticket.bounty }} points, set by {{ directory.personName(ticket.bounty_set_by) }}</template>
              <template v-else>None yet</template>
            </dd>
            <dt>Opened</dt>
            <dd>{{ formatDate(ticket.created_at) }} by {{ directory.personName(ticket.created_by) }}</dd>
            <template v-if="ticket.status === 'closed' && ticket.closed_at">
              <dt>Closed</dt>
              <dd>{{ formatDate(ticket.closed_at) }} by {{ directory.personName(ticket.closed_by) }}</dd>
            </template>
          </dl>
        </section>

        <section v-if="awards.length" class="panel">
          <h2>Points paid out</h2>
          <ul class="plain-list">
            <li v-for="award in awards" :key="award.id">{{ directory.personName(award.user_id) }}: <strong>{{ award.points }}</strong></li>
          </ul>
        </section>

        <section class="panel">
          <h2>Shop sessions</h2>
          <ul v-if="sessions.length" class="plain-list">
            <li v-for="session in sessions" :key="session.id">
              <RouterLink :to="`/sessions/${session.id}`">{{ session.title }}</RouterLink>
              <span class="muted"> · {{ formatSessionTime(session.starts_at, session.ends_at) }}</span>
            </li>
          </ul>
          <p v-else class="empty">Not planned for any session yet.</p>
        </section>
      </template>
    </template>

    <CloseTicketDialog v-if="ticket" :open="closing" :ticket="ticket" @close="closing = false" @closed="onClosed" />
  </div>
</template>

<style scoped>
.back {
  color: inherit;
  opacity: 0.75;
  text-decoration: none;
}

.page-header h1 {
  overflow-wrap: anywhere;
}

.number {
  opacity: 0.55;
  font-weight: 400;
}

.header-actions,
.form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.form-actions {
  justify-content: flex-end;
  margin-top: 8px;
}

.warning {
  color: #d0711a;
  opacity: 1;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.description {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.details {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 6px 16px;
  margin: 0;
}

.details dt {
  opacity: 0.7;
}

.details dd {
  margin: 0;
}

.details a,
.plain-list a {
  color: var(--header-hover-color);
}

.plain-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding-left: 18px;
}

@media (max-width: 480px) {
  .details {
    grid-template-columns: 1fr;
    gap: 0;
  }

  .details dd {
    margin-bottom: 8px;
  }
}
</style>
