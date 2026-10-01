<script setup lang="ts">
import { computed, ref } from 'vue';
import { formatDuration, histogram, mean, median } from '@/lib/stats/pit-stats';

// How a set of durations is spread: one bar per time range, as tall as the
// number of times that fell in it. A single series, so the title names it
// and there's no legend. Hovering (or focusing) a bar shows its count.
const props = defineProps<{ title: string; values: number[]; unit?: string }>();

const bins = computed(() => histogram(props.values));
const peak = computed(() => Math.max(1, ...bins.value.map((b) => b.count)));
const summary = computed(() =>
  props.values.length ? `Average ${formatDuration(mean(props.values))} · median ${formatDuration(median(props.values))} · ${counted(props.values.length)}` : null
);
const hovered = ref<number | null>(null);
// "1 run", "3 runs". `unit` is the singular.
function counted(n: number) {
  return `${n} ${props.unit ?? 'run'}${n === 1 ? '' : 's'}`;
}
</script>

<template>
  <figure class="histogram viz-root">
    <figcaption>
      <span class="title">{{ title }}</span>
      <span v-if="summary" class="summary">{{ summary }}</span>
    </figcaption>

    <p v-if="!values.length" class="empty">No data yet.</p>
    <template v-else>
      <div class="plot" role="img" :aria-label="`${title}: ${bins.map((b) => `${b.label}: ${b.count}`).join(', ')}`">
        <div
          v-for="(bin, i) in bins"
          :key="bin.label"
          class="column"
          tabindex="0"
          @mouseenter="hovered = i"
          @mouseleave="hovered = null"
          @focus="hovered = i"
          @blur="hovered = null"
        >
          <span class="count" :class="{ zero: !bin.count }">{{ bin.count || '' }}</span>
          <span class="bar" :class="{ dim: hovered !== null && hovered !== i }" :style="{ height: `${(bin.count / peak) * 100}%` }"></span>
          <span v-if="hovered === i" class="tooltip">{{ bin.label }}: {{ counted(bin.count) }}</span>
        </div>
      </div>
      <div class="axis" aria-hidden="true">
        <span v-for="bin in bins" :key="bin.label">{{ bin.label }}</span>
      </div>
    </template>
  </figure>
</template>

<style scoped>
.histogram {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  margin: 0;
  padding: 14px 16px;
  border-radius: 10px;
  background: var(--tile-background-color);
}

figcaption {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.title {
  font-weight: 600;
}

.summary {
  font-size: 0.8rem;
  opacity: 0.7;
}

.empty {
  margin: 0;
  opacity: 0.6;
}

.plot {
  display: flex;
  align-items: flex-end;
  /* A 2px gap of surface between neighboring bars. */
  gap: 2px;
  height: 130px;
  border-bottom: 1px solid var(--viz-axis);
}

.column {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-end;
  height: 100%;
  min-width: 0;
  outline: none;
}

.count {
  font-size: 0.8rem;
  text-align: center;
}

.bar {
  min-height: 0;
  /* Rounded at the data end, square on the baseline. */
  border-radius: 4px 4px 0 0;
  background: var(--viz-series-1);
}

.bar.dim {
  opacity: 0.5;
}

.column:focus-visible .bar {
  outline: 2px solid var(--primary-text-color);
  outline-offset: 1px;
}

.tooltip {
  position: absolute;
  bottom: 100%;
  left: 50%;
  z-index: 1;
  transform: translateX(-50%);
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--viz-tooltip-bg);
  color: var(--viz-tooltip-fg);
  font-size: 0.8rem;
  white-space: nowrap;
  pointer-events: none;
}

.axis {
  display: flex;
  gap: 2px;
}

.axis span {
  flex: 1;
  min-width: 0;
  font-size: 0.7rem;
  text-align: center;
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
