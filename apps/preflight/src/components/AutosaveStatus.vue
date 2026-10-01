<script setup lang="ts">
import type { AutosaveState } from '@/lib/autosave';

// Inline "Saving… / Saved / error" indicator for autosaving dialogs.
defineProps<{ state: AutosaveState; error: string | null }>();
</script>

<template>
  <span class="autosave-status" :class="state" role="status" aria-live="polite">
    <template v-if="state === 'pending' || state === 'saving'">Saving…</template>
    <template v-else-if="state === 'saved'">Saved</template>
    <template v-else-if="state === 'error'">{{ error ?? "Couldn't save" }}</template>
    <template v-else>Changes save automatically</template>
  </span>
</template>

<style scoped>
.autosave-status {
  font-size: 0.8rem;
  opacity: 0.7;
}

.autosave-status.error {
  color: #e5534b;
  opacity: 1;
}
</style>
