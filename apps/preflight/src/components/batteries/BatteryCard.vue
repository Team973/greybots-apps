<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { batteryStatusLabels, formatReading, type Battery, type BatteryReadings } from '@/lib/batteries/batteries';

// One battery on the Batteries page (Batteries mockup): its number, and the
// latest state of charge, internal resistance, and resting voltage, plus the
// running total of energy discharged over all its uses.
const props = defineProps<{ battery: Battery; readings: BatteryReadings | null; installed: boolean; matches: number; whTotal: number | null }>();

const r = computed(
  () => props.readings ?? { resting_voltage: null, internal_resistance_mohm: null, state_of_charge: null, capacity_wh: null, measured_at: null }
);
</script>

<template>
  <RouterLink :to="`/batteries/${battery.number}`" class="battery-card" :class="[battery.status, { installed }]">
    <div class="cell" aria-hidden="true">
      <span class="terminals"><i></i><i></i></span>
      <span class="number">{{ battery.number }}</span>
    </div>
    <div class="info">
      <div class="readings">
        <span class="reading">{{ formatReading(r.state_of_charge, 0) }}<small>%</small></span>
        <span class="reading">{{ formatReading(r.internal_resistance_mohm) }}<small>mΩ</small></span>
        <span class="reading">{{ formatReading(r.resting_voltage, 2) }}<small>V</small></span>
        <span class="reading" title="Total Wh discharged over all uses">{{ formatReading(whTotal, 0) }}<small>Wh used</small></span>
      </div>
      <div class="tags">
        <span v-if="installed" class="tag installed-tag">In robot</span>
        <span v-if="battery.status !== 'active'" class="tag" :class="battery.status">{{ batteryStatusLabels[battery.status] }}</span>
        <span v-if="battery.set_name" class="label">{{ battery.set_name }}</span>
        <span v-if="battery.label" class="label">{{ battery.label }}</span>
        <span class="uses">{{ matches }} match{{ matches === 1 ? '' : 'es' }}</span>
      </div>
    </div>
  </RouterLink>
</template>

<style scoped>
.battery-card {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
  padding: 14px 16px;
  border-radius: 12px;
  border: 2px solid transparent;
  background: var(--tile-background-color);
  color: var(--primary-text-color);
  text-decoration: none;
}

.battery-card:hover {
  border-color: var(--accent-color);
}

.battery-card.installed {
  border-color: #2e7d32;
}

.battery-card.retired {
  opacity: 0.5;
}

/* A battery, drawn: body with two terminals and the big orange number. */
.cell {
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 92px;
  height: 78px;
  margin-top: 8px;
  border-radius: 8px;
  background: linear-gradient(#d9dcdf, #b4b9be);
}

.terminals {
  position: absolute;
  top: -8px;
  left: 12px;
  right: 12px;
  display: flex;
  justify-content: space-between;
}

.terminals i {
  width: 18px;
  height: 8px;
  border-radius: 3px 3px 0 0;
  background: #1a1a1a;
}

/* Red (positive) on the left. */
.terminals i:first-child {
  background: #c62828;
}

.number {
  color: #f57c00;
  font-size: 2.6rem;
  font-weight: 800;
  line-height: 1;
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.25);
}

.battery-card.suspect .cell {
  box-shadow: 0 0 0 3px #ffc107;
}

.info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.readings {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px 14px;
}

.reading {
  font-size: clamp(1.3rem, 2.2vw, 1.9rem);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.reading small {
  margin-left: 2px;
  font-size: 0.6em;
  font-weight: 400;
  opacity: 0.75;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  font-size: 0.8rem;
}

.tag {
  padding: 1px 8px;
  border-radius: 999px;
  font-weight: 700;
}

.installed-tag {
  background: #2e7d32;
  color: #fff;
}

.tag.suspect {
  background: #ffc107;
  color: #1a1a1a;
}

.tag.retired {
  background: var(--accent-color);
}

.label,
.uses {
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
