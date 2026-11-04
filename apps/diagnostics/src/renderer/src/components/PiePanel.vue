<script setup lang="ts">
import { computed, ref } from 'vue';

import { foldSlices, maxPieKeys, timeInStates, type PieMode, type PiePanel, type PieSlice } from '@shared/plots';
import type { SignalInfo } from '@shared/signals';
import { palette } from '@/palette';
import { useSeries } from '@/panel-data';

// Rollups over the span shown, as a pie (#144): each signal's share of
// their total (current by motor, in amp-seconds), or how long one signal
// spent at each of its values (time in each state, or zone).

const props = defineProps<{
  panel: PiePanel;
  session: string;
  signals: SignalInfo[];
  span: [number, number];
  dark: boolean;
  editing: boolean;
}>();

const emit = defineEmits<{
  update: [panel: PiePanel];
}>();

const themePalette = computed(() => (props.dark ? palette.dark : palette.light));
const otherColor = computed(() => (props.dark ? '#6b6b6b' : '#a3a3a3'));

const byKey = computed(() => new Map(props.signals.map((s) => [s.key, s])));
const labelOf = (key: string) => {
  const signal = byKey.value.get(key);
  return signal ? (signal.subsystem ? `${signal.subsystem} / ${signal.name}` : signal.name) : key;
};
const numbers = computed(() => props.signals.filter((s) => s.kind === 'number' && s.count !== 0));
const stateSignals = computed(() => props.signals.filter((s) => s.kind !== 'other' && s.count !== 0));

function update(change: Partial<PiePanel>) {
  emit('update', { ...props.panel, ...change });
}

function setMode(mode: PieMode) {
  // A pie of states is of one signal.
  update({ mode, keys: mode === 'states' ? props.panel.keys.slice(0, 1) : props.panel.keys });
}

function addKey(key: string) {
  if (!key || props.panel.keys.includes(key)) return;
  update({ keys: props.panel.mode === 'states' ? [key] : [...props.panel.keys, key].slice(0, maxPieKeys) });
}

// Shares need only each signal's mean (of every value, whatever's sent);
// states need every value.
const keys = computed(() => props.panel.keys);
const { series, error } = useSeries(computed(() => props.session), keys, computed(() => props.span),
  computed(() => (props.panel.mode === 'share' ? 2 : undefined)));

interface Slice extends PieSlice {
  color: string;
  // What's said beside its share: a mean, or a time.
  note: string;
}

const duration = computed(() => Math.max(0, props.span[1] - props.span[0]));

function formatSeconds(seconds: number): string {
  return seconds >= 120 ? `${(seconds / 60).toFixed(1)} min` : `${seconds.toFixed(1)} s`;
}

const slices = computed<Slice[]>(() => {
  if (props.panel.mode === 'share') {
    // Colour by the signal's place in the list, not by its size.
    return props.panel.keys.flatMap((key, i) => {
      const mean = series.value.get(key)?.stats?.mean;
      if (mean === undefined || !(mean > 0)) return [];
      const unit = byKey.value.get(key)?.unit || series.value.get(key)?.unit || '';
      return [{ label: labelOf(key), value: mean * duration.value, color: themePalette.value[i % themePalette.value.length], note: `mean ${mean.toPrecision(3)}${unit ? ` ${unit}` : ''}` }];
    });
  }
  const key = props.panel.keys[0];
  const s = key ? series.value.get(key) : null;
  if (!s) return [];
  const kind = s.kind;
  const states = timeInStates(s.times, s.values as ArrayLike<string | number>, props.span[0], props.span[1],
    (v) => (kind === 'boolean' ? (v ? 'true' : 'false') : String(v)));
  const folded = foldSlices(states, themePalette.value.length);
  // Colour by the state's name, so a state keeps its colour as the span moves.
  const names = folded.map((slice) => slice.label).filter((label) => label !== 'Other').sort();
  return folded.map((slice) => ({
    ...slice,
    color: slice.label === 'Other' ? otherColor.value : themePalette.value[names.indexOf(slice.label) % themePalette.value.length],
    note: formatSeconds(slice.value)
  }));
});

const total = computed(() => slices.value.reduce((sum, s) => sum + s.value, 0));
const left = computed(() => props.panel.keys.filter((key) => !slices.value.some((s) => s.label === labelOf(key))));

// The donut: arcs around the middle, with a gap of the card's colour between.
const size = 220;
const outer = size / 2 - 4;
const inner = outer * 0.58;
const hovered = ref<number | null>(null);

function point(angle: number, radius: number): string {
  return `${(size / 2 + radius * Math.sin(angle)).toFixed(2)} ${(size / 2 - radius * Math.cos(angle)).toFixed(2)}`;
}

const arcs = computed(() => {
  let angle = 0;
  return slices.value.map((slice, i) => {
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

const percent = (value: number) => (total.value > 0 ? `${((value / total.value) * 100).toFixed(value / total.value < 0.1 ? 1 : 0)}%` : '');
</script>

<template>
  <div class="pie-panel">
    <div v-if="editing" class="panel-settings">
      <label>
        <span class="hint small">Slices</span>
        <select :value="panel.mode" aria-label="What the slices are" @change="setMode(($event.target as HTMLSelectElement).value as PieMode)">
          <option value="share">Each signal's share of the total</option>
          <option value="states">Time at each value of one signal</option>
        </select>
      </label>
    </div>
    <div class="pie-tools">
      <select v-if="panel.mode === 'share' && panel.keys.length < maxPieKeys" value="" aria-label="Add a signal"
        @change="addKey(($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''">
        <option value="">+ Add a number…</option>
        <option v-for="s in numbers" :key="s.key" :value="s.key" :disabled="panel.keys.includes(s.key)">{{ labelOf(s.key) }}{{ s.unit ? ` (${s.unit})` : '' }}</option>
      </select>
      <select v-else-if="panel.mode === 'states'" :value="panel.keys[0] ?? ''" aria-label="Signal"
        @change="addKey(($event.target as HTMLSelectElement).value)">
        <option value="">Choose a signal…</option>
        <option v-for="s in stateSignals" :key="s.key" :value="s.key">{{ labelOf(s.key) }}</option>
      </select>
      <span class="hint small">Over {{ formatSeconds(duration) }} shown</span>
    </div>

    <div v-if="slices.length" class="pie-body">
      <svg :viewBox="`0 0 ${size} ${size}`" :width="size" :height="size" role="img" :aria-label="`Pie chart of ${slices.length} slices`">
        <path v-for="arc in arcs" :key="arc.i" :d="arc.path" :fill="arc.slice.color" class="slice"
          :class="{ dim: hovered !== null && hovered !== arc.i }" @mouseenter="hovered = arc.i" @mouseleave="hovered = null">
          <title>{{ arc.slice.label }}: {{ percent(arc.slice.value) }} ({{ arc.slice.note }})</title>
        </path>
        <text v-if="hovered !== null" :x="size / 2" :y="size / 2 - 4" text-anchor="middle" class="centre-value">{{ percent(slices[hovered].value) }}</text>
        <text v-if="hovered !== null" :x="size / 2" :y="size / 2 + 14" text-anchor="middle" class="centre-note">{{ slices[hovered].note }}</text>
      </svg>
      <table class="plain legend">
        <tbody>
          <tr v-for="(slice, i) in slices" :key="slice.label" :class="{ dim: hovered !== null && hovered !== i }"
            @mouseenter="hovered = i" @mouseleave="hovered = null">
            <td><span class="swatch" :style="{ background: slice.color }"></span></td>
            <td class="name">{{ slice.label }}</td>
            <td class="number">{{ percent(slice.value) }}</td>
            <td class="number hint">{{ slice.note }}</td>
            <td v-if="panel.mode === 'share'">
              <button class="remove" :aria-label="`Remove ${slice.label}`"
                @click="update({ keys: panel.keys.filter((k) => labelOf(k) !== slice.label) })">✕</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="panel.keys.length && panel.mode === 'states'" class="hint small">No values in the span shown.</p>
    <p v-else class="hint small">
      {{ panel.mode === 'share' ? 'Add numbers to compare: motor currents, say.' : 'Choose a state, mode or zone to see how long it spent at each.' }}
      Or drag one here from the signal list.
    </p>
    <div v-if="panel.mode === 'share' && left.length" class="left-out">
      <span class="hint small">None, or below zero, in the span:</span>
      <span v-for="key in left" :key="key" class="left-key small">
        {{ labelOf(key) }}
        <button class="remove" :aria-label="`Remove ${key}`" @click="update({ keys: panel.keys.filter((k) => k !== key) })">✕</button>
      </span>
    </div>
    <p v-if="error" class="error-text small">{{ error }}</p>
  </div>
</template>

<style scoped>
.pie-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pie-tools {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pie-tools select {
  min-width: 0;
  max-width: 70%;
}

.pie-body {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
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

.legend {
  flex: 1;
  min-width: 200px;
  width: auto;
}

.legend td {
  padding: 3px 6px;
  vertical-align: middle;
  font-size: 0.85rem;
}

.legend .name {
  overflow-wrap: anywhere;
}

.left-out {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 3px;
}
</style>
