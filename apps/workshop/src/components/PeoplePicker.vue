<script setup lang="ts">
import { computed } from 'vue';
import PersonSearch from './PersonSearch.vue';
import { useDirectoryStore } from '@/stores/directory-store';

// Picks people (a ticket's assignees, or with `single` its owner): the ones
// picked as removable chips, and a search box to find anyone else with a
// Workshop role by typing their name. With `single`, picking someone replaces
// whoever was there.
const props = withDefaults(defineProps<{ modelValue: string[]; disabled?: boolean; single?: boolean; addLabel?: string; label?: string; membersOnly?: boolean }>(), {
  disabled: false,
  single: false,
  membersOnly: false,
  addLabel: '',
  label: 'Add a person'
});
const emit = defineEmits<{ 'update:modelValue': [ids: string[]] }>();

const directory = useDirectoryStore();
const placeholder = computed(() => props.addLabel || (props.single ? (props.modelValue.length ? 'Change to…' : 'Type a name…') : 'Add someone…'));

function add(id: string) {
  emit('update:modelValue', props.single ? [id] : [...props.modelValue, id]);
}
const remove = (id: string) => emit('update:modelValue', props.modelValue.filter((p) => p !== id));
</script>

<template>
  <div class="people-picker">
    <span v-for="id in modelValue" :key="id" class="chip person">
      {{ directory.personName(id) }}
      <button v-if="!disabled" type="button" class="remove" :aria-label="`Remove ${directory.personName(id)}`" @click="remove(id)">×</button>
    </span>
    <PersonSearch v-if="!disabled" :exclude="modelValue" :placeholder="placeholder" :label="label" :members-only="membersOnly" @pick="add" />
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
</style>
