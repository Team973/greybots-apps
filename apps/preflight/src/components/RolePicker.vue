<script setup lang="ts">
import { computed } from 'vue';
import ChoicePicker from './ChoicePicker.vue';
import type { PitRole } from '@/lib/checklists/config';

// Picks a pit subteam (one of the pit roles from Pit setup, e.g. Mechanical
// or Programming) with a searchable dropdown. The value is the role's id, or
// '' for none.
const props = withDefaults(defineProps<{ modelValue: string; roles: PitRole[]; disabled?: boolean; emptyLabel?: string }>(), {
  disabled: false,
  emptyLabel: 'No subteam'
});
const emit = defineEmits<{ 'update:modelValue': [roleId: string] }>();

const choices = computed(() => props.roles.map((role) => ({ key: role.id, text: role.name || 'Unnamed role' })));
</script>

<template>
  <ChoicePicker
    :model-value="modelValue"
    :choices="choices"
    :disabled="disabled"
    :empty-label="emptyLabel"
    @update:model-value="(roleId: string) => emit('update:modelValue', roleId)"
  />
</template>
