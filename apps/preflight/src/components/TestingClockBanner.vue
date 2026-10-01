<script setup lang="ts">
import { computed } from 'vue';
import { clockOffset, useNow } from '@greybots/common/lib/now';
import { resetClock } from '@/lib/testing-clock';
import { useSessionStore } from '@/stores/session-store';

// Reminder that testing mode has shifted this device's clock. A strip at the
// top of the page content (in the flow, so it never covers buttons).
const session = useSessionStore();
const offset = clockOffset();
const now = useNow(1000);
const shifted = computed(() => offset.value !== 0);
const label = computed(() =>
  new Date(now.value).toLocaleString([], { weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })
);
</script>

<template>
  <div v-if="shifted" class="testing-banner" role="status">
    <strong>Testing mode</strong>
    <span>Clock set to {{ label }}</span>
    <button v-if="session.hasRole('admin')" @click="resetClock">Back to real time</button>
  </div>
</template>

<style scoped>
.testing-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  width: 100%;
  box-sizing: border-box;
  margin: -0.75rem 0 0.75rem;
  padding: 6px 14px;
  border-radius: 8px;
  background: #e65100;
  color: #fff;
  font-size: 0.9rem;
}

button {
  padding: 3px 10px;
  border: 1px solid rgba(255, 255, 255, 0.8);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}
</style>
