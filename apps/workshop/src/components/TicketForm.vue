<script setup lang="ts">
import { computed } from 'vue';
import ComponentChips from './ComponentChips.vue';
import PeoplePicker from './PeoplePicker.vue';
import { bountyOptions, bountySplit, canSetBounty, isInterested, statusLabels, type TicketDraft } from '@/lib/tickets';
import { useAuthStore } from '@/stores/auth-store';
import { useDirectoryStore } from '@/stores/directory-store';

// The fields of a ticket, for opening a new one or editing one. The bounty
// can only be set by a lead or admin who isn't the owner or an assignee (as
// the ticket will be once saved), and the form says why when it can't.
const props = defineProps<{
  // Who set the ticket's current bounty, when editing.
  bountySetBy?: string | null;
}>();
const draft = defineModel<TicketDraft>({ required: true });

const auth = useAuthStore();
const directory = useDirectoryStore();

const bountyAllowed = computed(() => canSetBounty(draft.value, auth.userId, auth.isLead));
const bountyNote = computed(() => {
  if (!auth.isLead) return 'Leads and admins set bounties.';
  if (isInterested(draft.value, auth.userId)) return "You're the owner or an assignee, so someone else sets the bounty.";
  return null;
});
// Whoever set the bounty is now on the ticket: saving clears it.
const bountyWillClear = computed(() => !!draft.value.bounty && !!props.bountySetBy && isInterested(draft.value, props.bountySetBy));
const split = computed(() => bountySplit(draft.value.bounty, draft.value.owner_id, draft.value.assignee_ids));

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

    <label class="field full">
      <span>Bounty (GreyPoints when it's completed)</span>
      <select v-model="draft.bounty" :disabled="!bountyAllowed">
        <option :value="null">No bounty</option>
        <option v-for="option in bountyOptions" :key="option.points" :value="option.points">{{ option.points }} points · {{ option.label }}</option>
      </select>
      <small v-if="bountyNote" class="muted">{{ bountyNote }}</small>
      <small v-if="bountyWillClear" class="warning">
        {{ directory.personName(bountySetBy) }} set this bounty and is now on the ticket, so saving clears it. Someone else will need to set it again.
      </small>
      <small v-else-if="split.length" class="muted">
        Split: {{ split.map((s) => `${directory.personName(s.userId)} ${s.points}`).join(', ') }}
      </small>
    </label>
  </div>
</template>

<style scoped>
.warning {
  color: #d0711a;
}
</style>
