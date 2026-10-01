<script setup lang="ts">
import { ref, watch } from 'vue';

// Modal built on the native <dialog> element (focus trapping, Esc to close).
const props = defineProps<{ open: boolean; title: string }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement | null>(null);

watch(
  () => [props.open, dialog.value] as const,
  ([open, el]) => {
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  },
  { immediate: true }
);
</script>

<template>
  <dialog ref="dialog" class="app-dialog" @close="emit('close')" @click.self="emit('close')">
    <div class="dialog-body">
      <h2>{{ title }}</h2>
      <slot />
      <div class="dialog-actions">
        <slot name="actions" />
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.app-dialog {
  width: min(520px, calc(100vw - 24px));
  /* Compact by design; scrolling is only a fallback on very short screens. */
  max-height: calc(100dvh - 24px);
  overflow-y: auto;
  padding: 0;
  border: none;
  border-radius: 12px;
  background: var(--tile-background-color);
  color: var(--primary-text-color);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
}

.app-dialog::backdrop {
  background: rgba(0, 0, 0, 0.5);
}

.dialog-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
}

h2 {
  margin: 0;
  font-size: 1.05rem;
}

.dialog-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 2px;
}
</style>
