<script setup lang="ts">
import { computed } from 'vue';
import { useDirectoryStore } from '@/stores/directory-store';

// Picks several people (a ticket's assignees): the ones picked as removable
// chips, and a dropdown to add anyone else with a Workshop role.
const props = withDefaults(defineProps<{ modelValue: string[]; disabled?: boolean; addLabel?: string }>(), {
  disabled: false,
  addLabel: 'Add someone…'
});
const emit = defineEmits<{ 'update:modelValue': [ids: string[]] }>();

const directory = useDirectoryStore();
const remaining = computed(() => directory.assignable.filter((p) => !props.modelValue.includes(p.user_id)));

function add(event: Event) {
  const select = event.target as HTMLSelectElement;
  if (select.value) emit('update:modelValue', [...props.modelValue, select.value]);
  select.value = '';
}
const remove = (id: string) => emit('update:modelValue', props.modelValue.filter((p) => p !== id));
</script>

<template>
  <div class="people-picker">
    <span v-for="id in modelValue" :key="id" class="chip person">
      {{ directory.personName(id) }}
      <button v-if="!disabled" type="button" class="remove" :aria-label="`Remove ${directory.personName(id)}`" @click="remove(id)">×</button>
    </span>
    <select v-if="!disabled && remaining.length" class="control add" aria-label="Add a person" @change="add">
      <option value="">{{ addLabel }}</option>
      <option v-for="person in remaining" :key="person.user_id" :value="person.user_id">{{ person.name }}</option>
    </select>
    <span v-if="disabled && !modelValue.length" class="muted">Nobody</span>
  </div>
</template>

<style scoped>
.people-picker {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.person {
  font-size: 0.85rem;
  padding: 3px 4px 3px 10px;
}

.remove {
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
}

.remove:hover {
  background: rgba(128, 128, 128, 0.25);
}

.add {
  flex: 1 1 140px;
  max-width: 220px;
}
</style>
