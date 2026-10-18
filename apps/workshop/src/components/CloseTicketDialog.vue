<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import AppDialog from '@greybots/common/components/AppDialog.vue';
import { errorMessage } from '@/lib/db';
import { bountyOptions, bountySplit, canSetBounty, closeReasons, closeTicket, type CloseReason, type Ticket } from '@/lib/tickets';
import { useAuthStore } from '@/stores/auth-store';
import { useDirectoryStore } from '@/stores/directory-store';

// Close a ticket (leads and admins). The reason matters: only "complete"
// pays out the bounty. A closer who isn't the owner or an assignee can settle
// the bounty here too, e.g. when the job turned out bigger than planned.
const props = defineProps<{ open: boolean; ticket: Ticket }>();
const emit = defineEmits<{ close: []; closed: [ticket: Ticket] }>();

const auth = useAuthStore();
const directory = useDirectoryStore();

const reason = ref<CloseReason>('complete');
const bounty = ref<number | null>(null);
const error = ref('');
const saving = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reason.value = 'complete';
    bounty.value = props.ticket.bounty;
    error.value = '';
  }
);

const bountyAllowed = computed(() => canSetBounty(props.ticket, auth.userId, auth.isLead));
const split = computed(() => (reason.value === 'complete' ? bountySplit(bounty.value, props.ticket.owner_id, props.ticket.assignee_ids) : []));
const nobodyToPay = computed(() => reason.value === 'complete' && !!bounty.value && split.value.length === 0);

async function save() {
  error.value = '';
  saving.value = true;
  try {
    const closed = await closeTicket(props.ticket, reason.value, bountyAllowed.value ? bounty.value : undefined);
    emit('closed', closed);
    emit('close');
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppDialog :open="open" :title="`Close #${ticket.number}`" @close="emit('close')">
    <fieldset class="reasons">
      <legend class="muted">Why is it being closed?</legend>
      <label v-for="option in closeReasons" :key="option.key" class="reason" :class="{ on: reason === option.key }">
        <input v-model="reason" type="radio" name="close-reason" :value="option.key" />
        <span>
          <strong>{{ option.label }}</strong>
          <small class="muted">{{ option.hint }}</small>
        </span>
      </label>
    </fieldset>

    <template v-if="reason === 'complete'">
      <label class="field">
        <span>Bounty</span>
        <select v-model="bounty" :disabled="!bountyAllowed">
          <option :value="null">No bounty</option>
          <option v-for="option in bountyOptions" :key="option.points" :value="option.points">{{ option.points }} points · {{ option.label }}</option>
        </select>
        <small v-if="!bountyAllowed" class="muted">You're on this ticket, so you can't change its bounty.</small>
      </label>
      <p v-if="split.length" class="hint">
        Pays out: {{ split.map((s) => `${directory.personName(s.userId)} ${s.points}`).join(', ') }}
      </p>
      <p v-else-if="nobodyToPay" class="hint">Nobody owns or is assigned to this ticket, so the bounty won't go to anyone.</p>
    </template>

    <p v-if="error" class="error-text">{{ error }}</p>
    <template #actions>
      <button type="button" class="button" @click="emit('close')">Cancel</button>
      <button type="button" class="button primary" :disabled="saving" @click="save">{{ saving ? 'Closing…' : 'Close ticket' }}</button>
    </template>
  </AppDialog>
</template>

<style scoped>
.reasons {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  border: none;
}

.reasons legend {
  margin-bottom: 4px;
  font-size: 0.85rem;
}

.reason {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid rgba(128, 128, 128, 0.35);
  border-radius: 8px;
  cursor: pointer;
}

.reason.on {
  border-color: var(--header-color);
}

.reason span {
  display: flex;
  flex-direction: column;
}
</style>
