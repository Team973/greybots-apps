<script setup lang="ts">
import { computed } from 'vue';
import SearchableDropdown from '@greybots/common/components/SearchableDropdown.vue';

// A searchable dropdown styled like Preflight's plain form controls. The
// value is a choice's key, or '' for none (shown as `emptyLabel`). Typing
// only filters: nothing outside the list can be entered.
const props = withDefaults(
  defineProps<{
    modelValue: string;
    choices: { key: string; text: string }[];
    disabled?: boolean;
    emptyLabel?: string;
    // Taller, to sit in a quick-add row rather than a form.
    roomy?: boolean;
  }>(),
  { disabled: false, emptyLabel: 'None', roomy: false }
);
const emit = defineEmits<{ 'update:modelValue': [key: string] }>();

const allChoices = computed(() => [{ key: '', text: props.emptyLabel }, ...props.choices]);
const currentText = computed(() => props.choices.find((c) => c.key === props.modelValue)?.text ?? '');
</script>

<template>
  <input v-if="disabled" class="choice-readonly" :value="currentText || emptyLabel" readonly />
  <SearchableDropdown
    v-else
    class="choice-picker"
    :class="{ roomy }"
    :choices="allChoices"
    :model-value="modelValue"
    :placeholder="emptyLabel"
    @update:model-value="(key: string) => emit('update:modelValue', key)"
  />
</template>

<style scoped>
/* Match the plain form controls it sits beside (see .field in base.css). */
.choice-picker :deep(.searchable-dropdown-input),
.choice-readonly {
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

.choice-picker.roomy :deep(.searchable-dropdown-input) {
  padding: 10px;
  border-radius: 8px;
  font-size: inherit;
}

.choice-picker :deep(.searchable-dropdown-input:focus) {
  border-color: var(--header-color);
}

.choice-picker :deep(.searchable-dropdown-list) {
  max-height: 200px;
}
</style>
