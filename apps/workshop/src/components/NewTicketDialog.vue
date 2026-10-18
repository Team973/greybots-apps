<script setup lang="ts">
import { ref, watch } from 'vue';
import AppDialog from '@greybots/common/components/AppDialog.vue';
import TicketForm from './TicketForm.vue';
import { errorMessage } from '@/lib/db';
import { createTicket, emptyDraft, type Ticket, type TicketDraft } from '@/lib/tickets';

// Open a new ticket. Anyone in Workshop (members and above) can. `preset`
// fills some fields in first, e.g. the milestone a ticket is opened from.
const props = defineProps<{ open: boolean; preset?: Partial<TicketDraft> }>();
const emit = defineEmits<{ close: []; created: [ticket: Ticket] }>();

const draft = ref<TicketDraft>(emptyDraft());
const error = ref('');
const saving = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    draft.value = { ...emptyDraft(), ...props.preset };
    error.value = '';
  }
);

async function save() {
  error.value = '';
  saving.value = true;
  try {
    const ticket = await createTicket(draft.value);
    emit('created', ticket);
    emit('close');
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppDialog :open="open" title="New ticket" @close="emit('close')">
    <form id="new-ticket-form" @submit.prevent="save">
      <TicketForm v-model="draft" />
    </form>
    <p v-if="error" class="error-text">{{ error }}</p>
    <template #actions>
      <button type="button" class="button" @click="emit('close')">Cancel</button>
      <button type="submit" form="new-ticket-form" class="button primary" :disabled="saving || !draft.title.trim()">
        {{ saving ? 'Opening…' : 'Open ticket' }}
      </button>
    </template>
  </AppDialog>
</template>
