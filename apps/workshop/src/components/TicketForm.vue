<script setup lang="ts">
import { computed } from 'vue';
import ComponentChips from './ComponentChips.vue';
import PeoplePicker from './PeoplePicker.vue';
import { statusLabels, type TicketDraft } from '@/lib/tickets';
import { useDirectoryStore } from '@/stores/directory-store';

// The fields of a ticket, for opening a new one or editing one.
const draft = defineModel<TicketDraft>({ required: true });

const directory = useDirectoryStore();

const milestones = computed(() => directory.milestones.filter((m) => !m.closed_at || m.id === draft.value.milestone_id));
</script>

<template>
  <div class="form-grid ticket-form">
    <label class="field full">
      <span>Title</span>
      <input v-model="draft.title" type="text" maxlength="200" placeholder="What needs doing?" required />
    </label>
    <label class="field full">
      <span>Description</span>
      <textarea v-model="draft.description" rows="4" placeholder="Details, links, what done looks like"></textarea>
    </label>

    <label class="field">
      <span>Owner (responsible for it getting done)</span>
      <select v-model="draft.owner_id">
        <option :value="null">Nobody yet</option>
        <option v-for="person in directory.assignable" :key="person.user_id" :value="person.user_id">{{ person.name }}</option>
      </select>
    </label>
    <label class="field">
      <span>Estimated completion</span>
      <input v-model="draft.due_date" type="date" />
    </label>

    <div class="field full">
      <span>Assignees (doing the work)</span>
      <PeoplePicker v-model="draft.assignee_ids" />
    </div>

    <label class="field">
      <span>Milestone</span>
      <select v-model="draft.milestone_id">
        <option :value="null">None</option>
        <option v-for="milestone in milestones" :key="milestone.id" :value="milestone.id">{{ milestone.name }}</option>
      </select>
    </label>
    <label class="field">
      <span>Status</span>
      <select v-model="draft.status">
        <option value="open">{{ statusLabels.open }}</option>
        <option value="in_progress">{{ statusLabels.in_progress }}</option>
      </select>
    </label>

    <div class="field full">
      <span>Components</span>
      <ComponentChips v-model="draft.component_ids" editable />
    </div>
  </div>
</template>
