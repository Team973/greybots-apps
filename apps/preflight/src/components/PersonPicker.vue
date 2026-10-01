<script setup lang="ts">
import { computed } from 'vue';
import SearchableDropdown from '@greybots/common/components/SearchableDropdown.vue';
import { usePeople } from '@/lib/people';

// Picks who something is assigned to: a searchable dropdown of the people
// the device knows (account holders and the kiosk crew, see lib/people.ts).
// The value is the person's name, or '' for nobody. Names can't be typed in
// freely; a name already saved that's no longer in the list stays selectable
// so opening an old record doesn't lose it.
const props = withDefaults(
  defineProps<{
    modelValue: string;
    disabled?: boolean;
    emptyLabel?: string;
    // Taller, to sit in a quick-add row rather than a form.
    roomy?: boolean;
  }>(),
  { disabled: false, emptyLabel: 'Unassigned', roomy: false }
);
const emit = defineEmits<{ 'update:modelValue': [name: string] }>();

const people = usePeople();
const choices = computed(() => {
  const names = [...people.value];
  if (props.modelValue && !names.includes(props.modelValue)) names.unshift(props.modelValue);
  return [{ key: '', text: props.emptyLabel }, ...names.map((name) => ({ key: name, text: name }))];
});
</script>

<template>
  <input v-if="disabled" class="person-readonly" :value="modelValue || emptyLabel" readonly />
  <SearchableDropdown
    v-else
    class="person-picker"
    :class="{ roomy }"
    :choices="choices"
    :model-value="modelValue"
    :placeholder="emptyLabel"
    @update:model-value="(name: string) => emit('update:modelValue', name)"
  />
</template>

<style scoped>
/* Match the plain form controls it sits beside (see .field in base.css). */
.person-picker :deep(.searchable-dropdown-input),
.person-readonly {
  width: 100%;
  /* The shared dropdown sizes itself to its longest choice; here the form
     row decides the width. */
  min-width: 0 !important;
  box-sizing: border-box;
  padding: 7px 8px;
  border-radius: 6px;
  border: 1px solid var(--accent-color);
  background: var(--background-color);
  color: var(--primary-text-color);
  font: inherit;
  font-size: 0.95rem;
}

.person-picker.roomy :deep(.searchable-dropdown-input) {
  padding: 10px;
  border-radius: 8px;
  font-size: inherit;
}

.person-picker :deep(.searchable-dropdown-input:focus) {
  border-color: var(--header-color);
}

.person-picker :deep(.searchable-dropdown-list) {
  max-height: 200px;
}
</style>
