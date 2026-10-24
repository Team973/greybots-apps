<script setup lang="ts">
import { computed } from 'vue';
import { useDirectoryStore, type Component } from '@/stores/directory-store';

// The components (parts of the team) a ticket touches. With `editable`, every
// active component is shown and tapping one toggles it; otherwise just the
// ticket's own.
const props = withDefaults(defineProps<{ modelValue: string[]; editable?: boolean }>(), { editable: false });
const emit = defineEmits<{ 'update:modelValue': [ids: string[]] }>();

const directory = useDirectoryStore();
const shown = computed<Component[]>(() => {
  if (!props.editable) return props.modelValue.map((id) => directory.component(id)).filter((c): c is Component => !!c);
  // Archived ones a ticket already has stay visible so they can be removed.
  return directory.components.filter((c) => !c.archived || props.modelValue.includes(c.id));
});

function toggle(id: string) {
  emit('update:modelValue', props.modelValue.includes(id) ? props.modelValue.filter((c) => c !== id) : [...props.modelValue, id]);
}
</script>

<template>
  <div class="component-chips">
    <template v-if="editable">
      <button
        v-for="component in shown"
        :key="component.id"
        type="button"
        class="chip toggle"
        :class="{ on: modelValue.includes(component.id) }"
        :style="{ '--component-color': component.color || 'var(--header-color)' }"
        :aria-pressed="modelValue.includes(component.id)"
        @click="toggle(component.id)"
      >
        {{ component.name }}
      </button>
      <span v-if="!shown.length" class="muted">No components yet. A lead can add them on the Setup page.</span>
    </template>
    <template v-else>
      <span v-for="component in shown" :key="component.id" class="chip" :style="{ '--component-color': component.color || 'rgba(128,128,128,0.6)' }">
        <i class="dot" aria-hidden="true"></i>{{ component.name }}
      </span>
    </template>
  </div>
</template>

<style scoped>
.component-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 6px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--component-color);
}

.toggle {
  padding: 3px 10px;
  background: transparent;
  color: var(--primary-text-color);
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}

.toggle.on {
  border-color: var(--component-color);
  background: color-mix(in srgb, var(--component-color) 22%, transparent);
  font-weight: 600;
}
</style>
