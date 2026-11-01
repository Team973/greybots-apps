<script setup lang="ts">
import type { SaveState } from '@/settings-draft';

// Whether settings edited on the page are saved (they save as they change).
defineProps<{ state: SaveState }>();
</script>

<template>
  <p class="save-state" :class="{ 'error-text': state === 'invalid' }">
    <template v-if="state === 'saving'">Saving…</template>
    <template v-else-if="state === 'saved'">All changes saved.</template>
    <template v-else-if="state === 'invalid'">Not saved until the problem below is put right.</template>
    <template v-else>Changes are saved as you make them.</template>
  </p>
</template>

<style scoped>
.save-state {
  margin: 0;
  font-size: 0.9rem;
  opacity: 0.8;
}
</style>
