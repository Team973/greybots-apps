<script setup lang="ts">
import { ref, watch } from 'vue';
import AutosaveStatus from '@/components/AutosaveStatus.vue';
import ChecklistEditor from './ChecklistEditor.vue';
import { useAutosave } from '@/lib/autosave';
import { getFlowChecklist, saveFlowChecklist, type ChecklistDef, type FlowChecklistId, type PitRole } from '@/lib/checklists/config';
import { useLiveQuery } from '@/lib/live-query';
import { useSessionStore } from '@/stores/session-store';

// Edits one of the checklists the pit flow runs at a fixed point (practice
// field, start of day, end of day). It always exists: a suggested one until
// it's edited. Saved automatically.
const props = defineProps<{ id: FlowChecklistId; heading: string; hint: string; roles: PitRole[]; canEdit: boolean }>();
const session = useSessionStore();

const remote = useLiveQuery<ChecklistDef | null>(() => getFlowChecklist(props.id), null);
const checklist = ref<ChecklistDef | null>(null);
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const autosave = useAutosave(() => checklist.value, (value) => saveFlowChecklist(props.id, clone(value!), session.user?.name ?? null), {
  enabled: () => props.canEdit && !!checklist.value,
  validate: (value) => {
    if (!value) return null;
    if (!value.name.trim()) return 'The checklist needs a name';
    return value.steps.some((s) => !s.title.trim()) ? 'Every step needs a title' : null;
  }
});
watch(
  remote,
  (value) => {
    if (value === null || ['pending', 'saving', 'error'].includes(autosave.state.value)) return;
    // Until it's saved, the suggested checklist is rebuilt on every read (its
    // roles follow the roster); don't let that reset edits in the form.
    if (checklist.value && JSON.stringify(value) === JSON.stringify(checklist.value)) return;
    checklist.value = clone(value);
    autosave.reset();
  },
  { immediate: true }
);
</script>

<template>
  <section v-if="checklist" class="panel">
    <header class="panel-header">
      <h2>{{ heading }}</h2>
      <AutosaveStatus v-if="canEdit" :state="autosave.state.value" :error="autosave.error.value" />
    </header>
    <p class="hint">{{ hint }}</p>
    <ChecklistEditor :checklist="checklist" :index="0" :count="1" :roles="roles" :can-edit="canEdit" auto-link-label="" fixed />
  </section>
</template>

<style scoped>
.hint {
  margin: 0;
  opacity: 0.7;
  font-size: 0.9rem;
}
</style>
