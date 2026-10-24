<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import ComponentChips from './ComponentChips.vue';
import { formatDay } from '@/lib/dates';
import { isOverdue, statusText, type Ticket } from '@/lib/tickets';
import { useAuthStore } from '@/stores/auth-store';
import { useDirectoryStore } from '@/stores/directory-store';

// One ticket in a list: number, title, status, who, when, and its bounty.
// The `actions` slot sits at the end of the row (remove from plan, move...).
const props = withDefaults(defineProps<{ ticket: Ticket; showMilestone?: boolean }>(), { showMilestone: false });

const auth = useAuthStore();
const directory = useDirectoryStore();

const people = computed(() => {
  const parts: string[] = [];
  if (props.ticket.owner_id) parts.push(`Owner ${directory.personName(props.ticket.owner_id)}`);
  if (props.ticket.assignee_ids.length) parts.push(props.ticket.assignee_ids.map((id) => directory.personName(id)).join(', '));
  return parts.join(' · ') || 'Unassigned';
});
const mine = computed(() => !!auth.userId && (props.ticket.owner_id === auth.userId || props.ticket.assignee_ids.includes(auth.userId)));
const milestone = computed(() => (props.showMilestone ? directory.milestone(props.ticket.milestone_id) : undefined));
</script>

<template>
  <li class="ticket-row" :class="{ closed: ticket.status === 'closed', mine }">
    <div class="main">
      <RouterLink :to="`/tickets/${ticket.number}`" class="title">
        <span class="number">#{{ ticket.number }}</span> {{ ticket.title }}
      </RouterLink>
      <div class="meta">
        <span class="chip" :class="[`status-${ticket.status}`, ticket.close_reason ? `reason-${ticket.close_reason}` : '']">{{ statusText(ticket) }}</span>
        <span v-if="ticket.bounty" class="chip points">{{ ticket.bounty }} pts</span>
        <span v-if="ticket.due_date" class="chip" :class="{ overdue: isOverdue(ticket) }">
          {{ isOverdue(ticket) ? 'Overdue · ' : 'Due ' }}{{ formatDay(ticket.due_date) }}
        </span>
        <span v-if="milestone" class="chip">{{ milestone.name }}</span>
        <ComponentChips :model-value="ticket.component_ids" />
      </div>
      <div class="people muted">{{ people }}</div>
    </div>
    <div v-if="$slots.actions" class="actions">
      <slot name="actions" />
    </div>
  </li>
</template>

<style scoped>
.ticket-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-left: 4px solid transparent;
  list-style: none;
}

.ticket-row.mine {
  border-left-color: var(--header-color);
}

.ticket-row.closed .title {
  opacity: 0.65;
}

.main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.title {
  color: inherit;
  font-weight: 600;
  text-decoration: none;
  overflow-wrap: anywhere;
}

.title:hover {
  text-decoration: underline;
}

.number {
  opacity: 0.6;
  font-weight: 400;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
}

.people {
  font-size: 0.85rem;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

@media (max-width: 560px) {
  .ticket-row {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
