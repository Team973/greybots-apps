<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import NewTicketDialog from '@/components/NewTicketDialog.vue';
import TicketRow from '@/components/TicketRow.vue';
import { errorMessage } from '@/lib/db';
import { fetchTickets, isInterested, type Ticket } from '@/lib/tickets';
import { useAuthStore } from '@/stores/auth-store';
import { useDirectoryStore } from '@/stores/directory-store';

// Every ticket, filterable by status, milestone, component, and person. The
// filters live in the URL, so a filtered list can be shared or bookmarked.
const auth = useAuthStore();
const directory = useDirectoryStore();
const route = useRoute();
const router = useRouter();

type StatusFilter = 'active' | 'closed' | 'all';
const query = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '');

const status = ref<StatusFilter>((query('status') as StatusFilter) || 'active');
const milestone = ref(query('milestone'));
const component = ref(query('component'));
const person = ref(query('person'));
const search = ref(query('q'));

const tickets = ref<Ticket[]>([]);
const loaded = ref(false);
const error = ref('');
const creating = ref(false);

async function load() {
  error.value = '';
  try {
    tickets.value = await fetchTickets({ status: status.value });
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loaded.value = true;
  }
}
watch(status, load, { immediate: true });

watch([status, milestone, component, person, search], () => {
  const next: Record<string, string> = {};
  if (status.value !== 'active') next.status = status.value;
  if (milestone.value) next.milestone = milestone.value;
  if (component.value) next.component = component.value;
  if (person.value) next.person = person.value;
  if (search.value.trim()) next.q = search.value.trim();
  router.replace({ query: next });
});

const shown = computed(() => {
  const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return tickets.value.filter((t) => {
    if (milestone.value === 'none' ? t.milestone_id : milestone.value && t.milestone_id !== milestone.value) return false;
    if (component.value && !t.component_ids.includes(component.value)) return false;
    if (person.value === 'unassigned' ? t.owner_id || t.assignee_ids.length : person.value && !isInterested(t, person.value)) return false;
    if (words.length) {
      const text = `#${t.number} ${t.title} ${t.description}`.toLowerCase();
      if (!words.every((w) => text.includes(w))) return false;
    }
    return true;
  });
});

function onCreated(ticket: Ticket) {
  router.push(`/tickets/${ticket.number}`);
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1>Tickets</h1>
      <button v-if="auth.isMember" class="button primary" @click="creating = true">New ticket</button>
    </header>

    <div class="filters">
      <div class="segmented" role="group" aria-label="Status">
        <button :class="{ on: status === 'active' }" @click="status = 'active'">Open</button>
        <button :class="{ on: status === 'closed' }" @click="status = 'closed'">Closed</button>
        <button :class="{ on: status === 'all' }" @click="status = 'all'">All</button>
      </div>
      <input v-model="search" class="control search" type="search" placeholder="Search tickets" aria-label="Search tickets" />
      <select v-model="person" class="control" aria-label="Person">
        <option value="">Anyone</option>
        <option :value="auth.userId">Me</option>
        <option value="unassigned">Unassigned</option>
        <option v-for="p in directory.assignable" :key="p.user_id" :value="p.user_id">{{ p.name }}</option>
      </select>
      <select v-model="milestone" class="control" aria-label="Milestone">
        <option value="">Any milestone</option>
        <option value="none">No milestone</option>
        <option v-for="m in directory.milestones" :key="m.id" :value="m.id">{{ m.name }}</option>
      </select>
      <select v-model="component" class="control" aria-label="Component">
        <option value="">Any component</option>
        <option v-for="c in directory.components" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
    </div>

    <p v-if="error" class="error-text">{{ error }}</p>
    <p v-if="!loaded" class="empty">Loading…</p>
    <template v-else>
      <p class="muted count">{{ shown.length }} {{ shown.length === 1 ? 'ticket' : 'tickets' }}</p>
      <ul v-if="shown.length" class="ticket-list">
        <TicketRow v-for="ticket in shown" :key="ticket.id" :ticket="ticket" show-milestone />
      </ul>
      <p v-else class="empty">No tickets match.</p>
    </template>

    <NewTicketDialog :open="creating" @close="creating = false" @created="onCreated" />
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.filters .control {
  flex: 1 1 150px;
}

.filters .search {
  flex: 2 1 200px;
}

.count {
  margin: 0;
  font-size: 0.85rem;
}

.ticket-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
}
</style>
