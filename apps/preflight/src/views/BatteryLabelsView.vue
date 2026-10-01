<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import '@material/web/button/filled-button';
import BatteryQr from '@/components/batteries/BatteryQr.vue';
import { listBatteries, type Battery } from '@/lib/batteries/batteries';
import { defaultTeamNumber } from '@/lib/constants';
import { useLiveQuery } from '@/lib/live-query';

// Printable QR labels (issue #87): one per battery, or just one with
// ?only=<number>. Only the labels print; the rest of the page is hidden.
const route = useRoute();
const batteries = useLiveQuery<Battery[]>(listBatteries, []);
const only = computed(() => (route.query.only ? Number(route.query.only) : null));
const labels = computed(() => batteries.value.filter((b) => (only.value === null ? b.status !== 'retired' : b.number === only.value)));

const print = () => window.print();
</script>

<template>
  <div class="labels-view">
    <header class="page-header no-print">
      <RouterLink to="/batteries" class="panel-link">← All batteries</RouterLink>
      <h1>Battery labels</h1>
      <span class="spacer"></span>
      <md-filled-button :disabled="!labels.length" @click="print">Print</md-filled-button>
    </header>
    <p class="hint no-print">
      {{ labels.length }} label{{ labels.length === 1 ? '' : 's' }}. Print at 100% scale; each label is 2 in wide. Retired batteries are left out.
    </p>

    <div class="sheet">
      <div v-for="battery in labels" :key="battery.id" class="label">
        <BatteryQr :number="battery.number" :size="150" />
        <div class="text">
          <span class="team">Team {{ defaultTeamNumber }}</span>
          <span class="number">{{ battery.number }}</span>
          <span v-if="battery.label" class="name">{{ battery.label }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.labels-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}

.page-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
}

.page-header h1 {
  margin: 0;
  font-size: 1.5rem;
}

.spacer {
  flex: 1;
}

.hint {
  margin: 0;
  opacity: 0.7;
}

.sheet {
  display: flex;
  flex-wrap: wrap;
  gap: 0.15in;
}

/* Always black on white, whatever the app theme: it's going on paper. */
.label {
  display: flex;
  align-items: center;
  gap: 0.1in;
  width: 2in;
  padding: 0.08in;
  border: 1px dashed #888;
  background: #fff;
  color: #000;
  box-sizing: border-box;
  break-inside: avoid;
}

.label :deep(img) {
  width: 0.95in;
  height: 0.95in;
}

.text {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  min-width: 0;
  line-height: 1.05;
}

.team {
  font-size: 8pt;
}

.number {
  font-size: 30pt;
  font-weight: 800;
}

.name {
  max-width: 100%;
  font-size: 6pt;
  text-align: center;
  overflow-wrap: anywhere;
}
</style>
