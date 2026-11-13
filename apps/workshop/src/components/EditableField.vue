<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';

// A value that turns into its editor when clicked (or Enter on it), for
// editing a ticket a field at a time. The page decides which field is open
// (one at a time) and what saving means; this handles opening, and closing
// on Escape (`cancel`) or a click anywhere else (`close`).
const props = withDefaults(defineProps<{ open: boolean; editable?: boolean; label: string }>(), { editable: true });
const emit = defineEmits<{ open: []; close: []; cancel: [] }>();

const root = ref<HTMLElement | null>(null);

function onPointerDown(event: PointerEvent) {
  if (root.value && !root.value.contains(event.target as Node)) emit('close');
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('cancel');
  }
}
watch(
  () => props.open,
  async (open) => {
    if (open) {
      // After the click that opened it has finished.
      setTimeout(() => document.addEventListener('pointerdown', onPointerDown, true));
      await nextTick();
      root.value?.querySelector<HTMLElement>('input:not([type="checkbox"]):not([type="radio"]), textarea, select')?.focus();
    } else {
      document.removeEventListener('pointerdown', onPointerDown, true);
    }
  }
);
onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown, true));
</script>

<template>
  <div ref="root" class="editable-field" :class="{ open }" @keydown="onKeydown">
    <slot v-if="open && editable" name="editor" />
    <div
      v-else-if="editable"
      class="value can-edit"
      role="button"
      tabindex="0"
      :aria-label="`Edit ${label}`"
      :title="`Edit ${label}`"
      @click="emit('open')"
      @keydown.enter.prevent="emit('open')"
    >
      <slot />
    </div>
    <div v-else class="value">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.editable-field {
  min-width: 0;
}

.value {
  min-height: 1.4em;
  overflow-wrap: anywhere;
}

.can-edit {
  margin: -4px -6px;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
}

.can-edit:hover {
  background: rgba(128, 128, 128, 0.14);
}

.can-edit:focus-visible {
  outline: 2px solid var(--header-hover-color);
  outline-offset: 0;
}
</style>
