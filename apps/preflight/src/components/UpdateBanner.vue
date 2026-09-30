<script setup lang="ts">
import { useRegisterSW } from 'virtual:pwa-register/vue';

// A new app version is only applied when someone taps Reload, so an update
// never interrupts a crew member mid-task.
const { needRefresh, updateServiceWorker } = useRegisterSW();
</script>

<template>
  <div v-if="needRefresh" class="update-banner">
    <span>A new version of Preflight is available.</span>
    <button @click="updateServiceWorker(true)">Reload</button>
    <button @click="needRefresh = false">Later</button>
  </div>
</template>

<style scoped>
.update-banner {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-radius: 8px;
  background: var(--tile-background-color);
  color: var(--primary-text-color);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
}

button {
  padding: 6px 12px;
  border: none;
  border-radius: 6px;
  background: var(--header-color);
  color: var(--header-text-color);
  font: inherit;
  cursor: pointer;
}
</style>
