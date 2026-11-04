<script setup lang="ts">
import { computed } from 'vue';

// A donut of slices, for the pie plot and reports' pie charts alike: arcs
// around the middle with a gap of the card's colour between, the hovered
// one's share and note in the middle.

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
  // What's said beside its share: a mean, or a time.
  note: string;
}

const props = defineProps<{
  slices: DonutSlice[];
}>();

// The slice pointed at, here or in a legend beside it.
const hovered = defineModel<number | null>('hovered', { default: null });

const size = 220;
const outer = size / 2 - 4;
const inner = outer * 0.58;

const total = computed(() => props.slices.reduce((sum, s) => sum + s.value, 0));

function point(angle: number, radius: number): string {
  return `${(size / 2 + radius * Math.sin(angle)).toFixed(2)} ${(size / 2 - radius * Math.cos(angle)).toFixed(2)}`;
}

const arcs = computed(() => {
  let angle = 0;
  return props.slices.map((slice, i) => {
    const sweep = total.value > 0 ? (slice.value / total.value) * Math.PI * 2 : 0;
    const start = angle;
    angle += sweep;
    // A whole circle is two halves (an arc can't end where it starts).
    const end = sweep >= Math.PI * 2 - 1e-6 ? start + Math.PI * 2 - 1e-4 : angle;
    const large = end - start > Math.PI ? 1 : 0;
    const path = `M ${point(start, outer)} A ${outer} ${outer} 0 ${large} 1 ${point(end, outer)} L ${point(end, inner)} A ${inner} ${inner} 0 ${large} 0 ${point(start, inner)} Z`;
    return { i, path, slice };
  });
});

const percent = (value: number) => sharePercent(value, total.value);
</script>

<script lang="ts">
// A share as a percentage: a decimal place under 10%.
export function sharePercent(value: number, total: number): string {
  return total > 0 ? `${((value / total) * 100).toFixed(value / total < 0.1 ? 1 : 0)}%` : '';
}
</script>

<template>
  <svg :viewBox="`0 0 ${size} ${size}`" :width="size" :height="size" role="img" :aria-label="`Pie chart of ${slices.length} slices`" class="donut">
    <path v-for="arc in arcs" :key="arc.i" :d="arc.path" :fill="arc.slice.color" class="slice"
      :class="{ dim: hovered !== null && hovered !== arc.i }" @mouseenter="hovered = arc.i" @mouseleave="hovered = null">
      <title>{{ arc.slice.label }}: {{ percent(arc.slice.value) }} ({{ arc.slice.note }})</title>
    </path>
    <template v-if="hovered !== null && slices[hovered]">
      <text :x="size / 2" :y="size / 2 - 4" text-anchor="middle" class="centre-value">{{ percent(slices[hovered].value) }}</text>
      <text :x="size / 2" :y="size / 2 + 14" text-anchor="middle" class="centre-note">{{ slices[hovered].note }}</text>
    </template>
  </svg>
</template>

<style scoped>
.donut {
  flex: none;
}

.slice {
  stroke: var(--tile-background-color);
  stroke-width: 2;
  transition: opacity 0.1s;
}

.dim {
  opacity: 0.45;
}

.centre-value {
  font-size: 20px;
  font-weight: 600;
  fill: currentColor;
}

.centre-note {
  font-size: 11px;
  fill: currentColor;
  opacity: 0.7;
}
</style>
