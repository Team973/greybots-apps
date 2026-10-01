<script setup lang="ts">
import { computed } from 'vue';
import ChoicePicker from './ChoicePicker.vue';
import { usePeople } from '@/lib/people';

// Picks who something is assigned to: a searchable dropdown of the people
// the device knows (account holders and the kiosk crew, see lib/people.ts).
// The value is the person's name, or '' for nobody. Names can't be typed in
// freely; a name already saved that's no longer in the list stays selectable
// so opening an old record doesn't lose it.
const props = withDefaults(defineProps<{ modelValue: string; disabled?: boolean; emptyLabel?: string; roomy?: boolean }>(), {
  disabled: false,
  emptyLabel: 'Unassigned',
  roomy: false
});
const emit = defineEmits<{ 'update:modelValue': [name: string] }>();

const people = usePeople();
const choices = computed(() => {
  const names = [...people.value];
  if (props.modelValue && !names.includes(props.modelValue)) names.unshift(props.modelValue);
  return names.map((name) => ({ key: name, text: name }));
});
</script>

<template>
  <ChoicePicker
    :model-value="modelValue"
    :choices="choices"
    :disabled="disabled"
    :empty-label="emptyLabel"
    :roomy="roomy"
    @update:model-value="(name: string) => emit('update:modelValue', name)"
  />
</template>
