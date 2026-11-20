<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import AppDialog from '@greybots/common/components/AppDialog.vue';
import { errorMessage } from '@/lib/db';
import { today } from '@/lib/dates';
import { createKeyDate, deleteKeyDate, updateKeyDate, type KeyDate } from '@/lib/keyDates';

// Add a key milestone to the schedule, or change or remove one (leads and
// admins). One day, or a run of days.
const props = defineProps<{
  open: boolean;
  // The one being changed; none to add one.
  keyDate?: KeyDate | null;
  // The days a new one covers (from dragging across the all-day row), inclusive.
  start?: string | null;
  end?: string | null;
}>();
const emit = defineEmits<{ close: []; saved: [] }>();

const title = ref('');
const startDate = ref('');
const endDate = ref('');
const notes = ref('');
const confirmingDelete = ref(false);
const error = ref('');
const saving = ref(false);

const editing = computed(() => !!props.keyDate);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    error.value = '';
    confirmingDelete.value = false;
    const k = props.keyDate;
    title.value = k?.title ?? '';
    startDate.value = k?.start_date ?? props.start ?? today();
    endDate.value = k?.end_date ?? props.end ?? startDate.value;
    notes.value = k?.notes ?? '';
  }
);

// Moving the first day past the last takes the last day with it.
watch(startDate, (value) => {
  if (value && endDate.value < value) endDate.value = value;
});

async function run(action: () => Promise<unknown>) {
  error.value = '';
  saving.value = true;
  try {
    await action();
    emit('saved');
    emit('close');
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

function save() {
  const fields = { title: title.value.trim(), start_date: startDate.value, end_date: endDate.value || startDate.value, notes: notes.value.trim() };
  const k = props.keyDate;
  return run(() => (k ? updateKeyDate(k.id, fields) : createKeyDate(fields)));
}

function remove() {
  const k = props.keyDate;
  if (k) return run(() => deleteKeyDate(k.id));
}
</script>

<template>
  <AppDialog :open="open" :title="editing ? 'Change milestone' : 'Add a key milestone'" @close="emit('close')">
    <form id="key-date-form" class="form-grid" @submit.prevent="save">
      <label class="field full">
        <span>Name</span>
        <input v-model="title" type="text" maxlength="80" placeholder="e.g. Robot reveal" required />
      </label>
      <label class="field">
        <span>First day</span>
        <input v-model="startDate" type="date" required />
      </label>
      <label class="field">
        <span>Last day</span>
        <input v-model="endDate" type="date" :min="startDate" required />
      </label>
      <label class="field full">
        <span>Notes</span>
        <textarea v-model="notes" rows="2"></textarea>
      </label>
    </form>

    <p v-if="error" class="error-text">{{ error }}</p>
    <template #actions>
      <template v-if="editing">
        <button v-if="!confirmingDelete" type="button" class="button danger" :disabled="saving" @click="confirmingDelete = true">Remove…</button>
        <button v-else type="button" class="button danger" :disabled="saving" @click="remove">Confirm: remove it</button>
      </template>
      <span class="actions-spacer"></span>
      <button type="button" class="button" @click="emit('close')">Close</button>
      <button type="submit" form="key-date-form" class="button primary" :disabled="saving || !title.trim()">{{ saving ? 'Saving…' : editing ? 'Save' : 'Add' }}</button>
    </template>
  </AppDialog>
</template>

<style scoped>
.full {
  flex-basis: 100%;
}
</style>
