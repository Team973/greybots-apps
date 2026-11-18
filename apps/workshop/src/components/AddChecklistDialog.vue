<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import AppDialog from '@greybots/common/components/AppDialog.vue';
import PeoplePicker from './PeoplePicker.vue';
import { addChecklist, fetchTemplates, type ChecklistTemplate } from '@/lib/checklists';
import { errorMessage } from '@/lib/db';

// Leads and admins: add a copy of a checklist template to a session, with an
// owner (every step starts out assigned to them).
const props = defineProps<{ open: boolean; sessionId: string }>();
const emit = defineEmits<{ close: []; added: [id: string] }>();

const templates = ref<ChecklistTemplate[]>([]);
const templateId = ref<string | null>(null);
const ownerIds = ref<string[]>([]);
const error = ref('');
const busy = ref(false);

const active = computed(() => templates.value.filter((t) => !t.archived));

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    error.value = '';
    templateId.value = null;
    ownerIds.value = [];
    try {
      templates.value = await fetchTemplates();
      if (active.value.length === 1) templateId.value = active.value[0].id;
    } catch (e) {
      error.value = errorMessage(e);
    }
  }
);

async function add() {
  if (!templateId.value || !ownerIds.value[0]) return;
  error.value = '';
  busy.value = true;
  try {
    const id = await addChecklist(props.sessionId, templateId.value, ownerIds.value[0]);
    emit('added', id);
    emit('close');
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppDialog :open="open" title="Add a checklist to this session" @close="emit('close')">
    <p v-if="error" class="error-text">{{ error }}</p>
    <template v-if="active.length">
      <label class="field">
        <span>Checklist</span>
        <select v-model="templateId">
          <option :value="null" disabled>Pick one…</option>
          <option v-for="template in active" :key="template.id" :value="template.id">{{ template.name }}</option>
        </select>
      </label>
      <div class="field">
        <span>Owner (gets every step to start with, and signs it off)</span>
        <PeoplePicker v-model="ownerIds" single members-only label="Owner" />
      </div>
    </template>
    <p v-else class="empty">
      No checklists to add yet. <RouterLink to="/checklists/templates/new" @click="emit('close')">Write one</RouterLink> first.
    </p>
    <template #actions>
      <button class="button" @click="emit('close')">Cancel</button>
      <button class="button primary" :disabled="busy || !templateId || !ownerIds.length" @click="add">Add</button>
    </template>
  </AppDialog>
</template>
