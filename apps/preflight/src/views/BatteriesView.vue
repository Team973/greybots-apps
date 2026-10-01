<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import '@material/web/button/filled-button';
import '@material/web/button/outlined-button';
import AddBatteryDialog from '@/components/batteries/AddBatteryDialog.vue';
import BatteryCard from '@/components/batteries/BatteryCard.vue';
import BatteryScanner from '@/components/batteries/BatteryScanner.vue';
import { nextBatteryNumber, useCounts } from '@/lib/batteries/batteries';
import { useBatteries } from '@/lib/batteries/use-batteries';
import { useSessionStore } from '@/stores/session-store';

// Batteries page (issue #87, Batteries mockup): a grid of battery cards with
// each battery's number, %, V, mΩ, and Wh. Tap a card (or scan its label)
// for measurements, assignment, and history.
const session = useSessionStore();
const router = useRouter();
const canEdit = computed(() => session.hasRole('member'));

const { batteries, readings, usesByBattery, installed } = useBatteries();

const showRetired = ref(false);
const retiredCount = computed(() => batteries.value.filter((b) => b.status === 'retired').length);
const visible = computed(() => batteries.value.filter((b) => showRetired.value || b.status !== 'retired'));

const addOpen = ref(false);
const scanOpen = ref(false);
function onScanned(number: number) {
  scanOpen.value = false;
  router.push(`/batteries/${number}`);
}
</script>

<template>
  <div class="batteries-view">
    <header class="page-header">
      <h1>Batteries</h1>
      <span class="spacer"></span>
      <label v-if="retiredCount" class="retired-toggle"><input v-model="showRetired" type="checkbox" /> Show retired ({{ retiredCount }})</label>
      <md-outlined-button @click="scanOpen = true">Scan label</md-outlined-button>
      <RouterLink v-if="batteries.length" to="/batteries/labels" class="link-button">Print labels</RouterLink>
      <md-filled-button v-if="canEdit" @click="addOpen = true">Add battery</md-filled-button>
    </header>

    <div v-if="visible.length" class="grid">
      <BatteryCard
        v-for="battery in visible"
        :key="battery.id"
        :battery="battery"
        :readings="readings.get(battery.id) ?? null"
        :installed="installed?.battery_id === battery.id"
        :matches="useCounts(usesByBattery.get(battery.id) ?? []).matches"
      />
    </div>
    <p v-else class="hint">
      No batteries registered yet.<template v-if="canEdit"> Add each battery by the number written on it, then print its QR label.</template>
    </p>

    <AddBatteryDialog :open="addOpen" :next-number="nextBatteryNumber(batteries)" @close="addOpen = false" />
    <BatteryScanner :open="scanOpen" @close="scanOpen = false" @scanned="onScanned" />
  </div>
</template>

<style scoped>
.batteries-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}

.page-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.page-header h1 {
  margin: 0;
  font-size: 1.8rem;
}

.spacer {
  flex: 1;
}

.retired-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.9rem;
  opacity: 0.8;
}

.link-button {
  padding: 9px 20px;
  border: 1px solid var(--accent-color);
  border-radius: 999px;
  color: var(--primary-text-color);
  font-size: 0.9rem;
  text-decoration: none;
}

/* Three across on a pit laptop, as in the mockup. */
.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

@media (max-width: 1100px) {
  .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 700px) {
  .grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.hint {
  margin: 0;
  opacity: 0.7;
}
</style>
