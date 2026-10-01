<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { formatReading } from '@/lib/batteries/batteries';
import { useBatteries } from '@/lib/batteries/use-batteries';

// The battery that's in the robot right now (issue #87), shown wherever the
// robot's status is. Links to that battery.
const { installed, installedBattery, readings } = useBatteries();
const voltage = computed(() => (installedBattery.value ? readings.value.get(installedBattery.value.id)?.resting_voltage ?? null : null));
</script>

<template>
  <RouterLink v-if="installedBattery" :to="`/batteries/${installedBattery.number}`" class="battery-chip" :class="installedBattery.status">
    <span class="tag">Battery {{ installedBattery.number }}</span>
    <span class="what">
      <template v-if="installed?.label">{{ installed.label }}</template>
      <template v-if="voltage !== null"> · {{ formatReading(voltage, 2) }} V</template>
      <template v-if="installedBattery.status === 'suspect'"> · suspect</template>
    </span>
  </RouterLink>
  <RouterLink v-else to="/batteries" class="battery-chip none"><span class="what">No battery recorded</span></RouterLink>
</template>

<style scoped>
.battery-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  padding: 3px 12px 3px 3px;
  border-radius: 999px;
  background: #1a1a1a;
  color: #fff;
  font-size: 0.95rem;
  text-decoration: none;
}

.battery-chip.none {
  padding-left: 12px;
  opacity: 0.75;
}

.tag {
  flex: none;
  padding: 1px 10px;
  border-radius: 999px;
  background: #2e7d32;
  font-size: 0.8rem;
  font-weight: 700;
}

.battery-chip.suspect .tag {
  background: #ffc107;
  color: #1a1a1a;
}

.what {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
