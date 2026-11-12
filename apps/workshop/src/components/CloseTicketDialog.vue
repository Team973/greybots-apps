<script setup lang="ts">
import { ref, watch } from 'vue';
import AppDialog from '@greybots/common/components/AppDialog.vue';
import { errorMessage } from '@/lib/db';
import { closeReasons, closeTicket, type CloseReason, type Ticket } from '@/lib/tickets';

// Close a ticket (leads and admins), saying why.
const props = defineProps<{ open: boolean; ticket: Ticket }>();
const emit = defineEmits<{ close: []; closed: [ticket: Ticket] }>();

const reason = ref<CloseReason>('complete');
const error = ref('');
const saving = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reason.value = 'complete';
    error.value = '';
  }
);

async function save() {
  error.value = '';
  saving.value = true;
  try {
    const closed = await closeTicket(props.ticket, reason.value);
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
