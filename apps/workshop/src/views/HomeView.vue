<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import ChecklistRow from '@/components/ChecklistRow.vue';
import EventCountdown from '@/components/EventCountdown.vue';
import NewTicketDialog from '@/components/NewTicketDialog.vue';
import TicketRow from '@/components/TicketRow.vue';
import { fetchMyChecklists, fetchSessionChecklists, openStepsFor, type FullChecklist } from '@/lib/checklists';
import { errorMessage } from '@/lib/db';
import { formatSessionTime } from '@/lib/dates';
import { fetchNextSession, fetchPlan, seedPlan, type Session } from '@/lib/sessions';
import { fetchTickets, fetchTicketsByIds, isInterested, type Ticket } from '@/lib/tickets';
import { useAuthStore } from '@/stores/auth-store';
import { useDirectoryStore } from '@/stores/directory-store';

// "My tasks": what's on your plate. First, how many shop sessions are left
// before the next event; then the next shop session
// and the tickets you own or are assigned to in its plan come first (and its
// checklists), then your checklist steps, then everything else of yours
// that's still open.
const auth = useAuthStore();
const directory = useDirectoryStore();

const session = ref<Session | null>(null);
const planTickets = ref<Ticket[]>([]);
const myTickets = ref<Ticket[]>([]);
const sessionChecklists = ref<FullChecklist[]>([]);
const myChecklists = ref<FullChecklist[]>([]);
const loaded = ref(false);
const error = ref('');
const creating = ref(false);

const happeningNow = computed(() => !!session.value && Date.parse(session.value.starts_at) <= Date.now());
const mineInSession = computed(() => planTickets.value.filter((t) => isInterested(t, auth.userId)));
const othersInSession = computed(() => planTickets.value.filter((t) => !isInterested(t, auth.userId)));
const planIds = computed(() => new Set(planTickets.value.map((t) => t.id)));
// Steps of yours not done yet, across your checklists.
const myOpenSteps = computed(() => myChecklists.value.reduce((n, c) => n + openStepsFor(c, auth.userId).length, 0));

// Soonest due first; no date last.
const otherOpen = computed(() =>
  myTickets.value
    .filter((t) => !planIds.value.has(t.id))
    .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || a.number - b.number)
);

async function load() {
  error.value = '';
  try {
    const next = await fetchNextSession();
    session.value = next;
    if (next) {
      // The first look at a session starts its plan from the last one's
      // unfinished tickets.
      if (!next.plan_seeded) await seedPlan(next.id).catch(() => 0);
      const plan = await fetchPlan(next.id);
      const order = new Map(plan.map((p) => [p.ticket_id, p.sort_order]));
      planTickets.value = (await fetchTicketsByIds(plan.map((p) => p.ticket_id))).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
      sessionChecklists.value = await fetchSessionChecklists(next.id);
    } else {
      planTickets.value = [];
      sessionChecklists.value = [];
    }
    [myTickets.value, myChecklists.value] = await Promise.all([fetchTickets({ status: 'active', involving: auth.userId! }), fetchMyChecklists(auth.userId!)]);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loaded.value = true;
  }
}
onMounted(load);
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1>Hi, {{ auth.name }}</h1>
      <button v-if="auth.isMember" class="button primary" @click="creating = true">New ticket</button>
    </header>
    <p v-if="error" class="error-text">{{ error }}</p>
    <p v-if="!loaded" class="empty">Loading…</p>

    <template v-else>
      <EventCountdown />

      <section class="panel session" :class="{ now: happeningNow }">
        <div class="panel-header">
          <h2>{{ session ? (happeningNow ? 'Shop is on now' : 'Next shop session') : 'No shop sessions coming up' }}</h2>
          <RouterLink v-if="session" :to="`/sessions/${session.id}`" class="button small">Session plan</RouterLink>
          <RouterLink v-else to="/sessions" class="button small">Schedule</RouterLink>
        </div>
        <p v-if="session" class="when">
          <strong>{{ session.title }}</strong> · {{ formatSessionTime(session.starts_at, session.ends_at) }}
          <template v-if="session.shop_boss"> · Shop boss: {{ directory.personName(session.shop_boss) }}</template>
        </p>
        <p v-if="session?.notes" class="notes">{{ session.notes }}</p>

        <template v-if="session">
          <h3>Your tickets this session</h3>
          <ul v-if="mineInSession.length" class="ticket-list">
            <TicketRow v-for="ticket in mineInSession" :key="ticket.id" :ticket="ticket" />
          </ul>
          <p v-else class="empty">
            None of your tickets are planned for this session.
            <template v-if="othersInSession.length">Pick up one of the {{ othersInSession.length }} other planned tickets with a lead.</template>
          </p>
          <details v-if="othersInSession.length" class="rest">
            <summary>The rest of the plan ({{ othersInSession.length }})</summary>
            <ul class="ticket-list">
              <TicketRow v-for="ticket in othersInSession" :key="ticket.id" :ticket="ticket" />
            </ul>
          </details>

          <template v-if="sessionChecklists.length">
            <h3>Checklists this session</h3>
            <ul class="ticket-list">
              <ChecklistRow v-for="checklist in sessionChecklists" :key="checklist.id" :checklist="checklist" />
            </ul>
          </template>
        </template>
      </section>

      <section v-if="myChecklists.length" class="panel">
        <div class="panel-header">
          <h2>Your checklists</h2>
          <span class="muted">{{ myOpenSteps }} {{ myOpenSteps === 1 ? 'step' : 'steps' }} to do</span>
        </div>
        <ul class="ticket-list">
          <ChecklistRow v-for="checklist in myChecklists" :key="checklist.id" :checklist="checklist" show-session />
        </ul>
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2>Your other open tickets</h2>
          <RouterLink to="/tickets" class="button small">All tickets</RouterLink>
        </div>
        <ul v-if="otherOpen.length" class="ticket-list">
          <TicketRow v-for="ticket in otherOpen" :key="ticket.id" :ticket="ticket" show-milestone />
        </ul>
        <p v-else class="empty">{{ myTickets.length ? 'Everything of yours is in the session plan.' : "You don't own and aren't assigned to any open tickets." }}</p>
      </section>
    </template>

    <NewTicketDialog :open="creating" @close="creating = false" @created="load" />
  </div>
</template>

<style scoped>
.session.now {
  box-shadow: inset 4px 0 0 var(--header-color);
}

.when,
.notes {
  margin: 0;
}

.notes {
  white-space: pre-wrap;
  opacity: 0.85;
}

h3 {
  margin: 6px 0 0;
  font-size: 1rem;
}

.ticket-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
}

.rest summary {
  cursor: pointer;
  opacity: 0.8;
  margin-bottom: 6px;
}
</style>
