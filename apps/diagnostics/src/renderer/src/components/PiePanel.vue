<script setup lang="ts">
import { computed, ref } from 'vue';

import { foldSlices, maxPieKeys, timeInStates, type PieMeasure, type PieMode, type PiePanel } from '@shared/plots';
import { integrateProduct, pairedVoltage, type SignalInfo } from '@shared/signals';
import PieChart, { sharePercent, type DonutSlice } from '@/components/PieChart.vue';
import { palette } from '@/palette';
import { useSeries } from '@/panel-data';

// Rollups over the span shown, as a pie (#144): each signal's share of
// their total (current by motor, in amp-seconds), or of the energy they
// drew (current times voltage, in watt-hours), a signal or a group of them
// to a slice; or how long one signal spent at each of its values (time in
// each state, or zone).

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

const full = computed(() => props.panel.keys.length + props.panel.groups.length >= maxPieKeys);
function addKey(key: string) {
  if (!key || props.panel.keys.includes(key)) return;
  if (props.panel.mode === 'states') update({ keys: [key] });
  else if (!full.value) update({ keys: [...props.panel.keys, key] });
}

// --- Slices of shares: a signal each, then the groups ---

const energy = computed(() => props.panel.mode === 'share' && props.panel.measure === 'energy');

interface Share {
  label: string;
  keys: string[];
  // In the panel: a signal of `keys`, or a group of `groups`.
  key?: string;
  group?: number;
}
const shares = computed<Share[]>(() => [
  ...props.panel.keys.map((key) => ({ label: labelOf(key), keys: [key], key })),
  ...props.panel.groups.map((g, group) => ({ label: g.label || g.keys.map(labelOf).join(', '), keys: g.keys, group }))
]);
const voltageOf = (key: string) => props.panel.voltage || pairedVoltage(key);

// Shares of charge need only each signal's mean (of every value, whatever's
// sent); energy needs every value of each current and its voltage, and
// states every value of the one signal.
const keys = computed(() => {
  if (props.panel.mode === 'states') return props.panel.keys.slice(0, 1);
  const currents = shares.value.flatMap((s) => s.keys);
  return energy.value ? [...new Set([...currents, ...currents.map(voltageOf)])] : [...new Set(currents)];
});
const { series, error } = useSeries(computed(() => props.session), keys, computed(() => props.span),
  computed(() => (props.panel.mode === 'share' && !energy.value ? 2 : undefined)));

const duration = computed(() => Math.max(0, props.span[1] - props.span[0]));

function formatSeconds(seconds: number): string {
  return seconds >= 120 ? `${(seconds / 60).toFixed(1)} min` : `${seconds.toFixed(1)} s`;
}

const formatNumber = (value: number, unit: string) => `${Math.abs(value) >= 1000 ? value.toFixed(0) : value.toPrecision(3)}${unit ? ` ${unit}` : ''}`;

// A share's total over the span: amp-seconds (its mean times the span) or
// watt-hours; and its mean (amps, or watts). Null when none of its signals
// has values there.
function measureShare(share: Share): { value: number; mean: number; unit: string } | null {
  let value = 0;
  let mean = 0;
  let found = false;
  let unit = '';
  for (const key of share.keys) {
    const current = series.value.get(key);
    if (energy.value) {
      const voltage = series.value.get(voltageOf(key));
      if (!current?.times.length || !voltage?.times.length) continue;
      value += integrateProduct(current.times, current.values as Float64Array, voltage.times, voltage.values as Float64Array, props.span[0], props.span[1]) / 3600;
    } else {
      if (current?.stats?.mean === undefined) continue;
      mean += current.stats.mean;
      unit ||= byKey.value.get(key)?.unit || current.unit || '';
    }
    found = true;
  }
  if (!found) return null;
  if (energy.value) return { value, mean: duration.value > 0 ? (value * 3600) / duration.value : 0, unit: 'W' };
  return { value: mean * duration.value, mean, unit };
}

interface Slice extends DonutSlice {
  share?: Share;
  mean?: number;
}

const measured = computed(() => shares.value.map((share) => ({ share, m: measureShare(share) })));

const slices = computed<Slice[]>(() => {
  if (props.panel.mode === 'share') {
    // Coloured in the list's order, so a slice keeps its colour as the span
    // moves; past the palette, the smallest are grey (not cycled).
    const steps = themePalette.value;
    const positive = measured.value.filter((x) => x.m && x.m.value > 0);
    const kept = positive.length <= steps.length ? positive : [...positive].sort((a, b) => b.m!.value - a.m!.value).slice(0, steps.length - 1);
    return positive
      .map((x) => ({
        label: x.share.label,
        value: x.m!.value,
        color: kept.includes(x) ? steps[kept.indexOf(x)] : otherColor.value,
        note: energy.value ? `${formatNumber(x.m!.value, 'Wh')} · ${formatNumber(x.m!.mean, 'W')}` : `mean ${formatNumber(x.m!.mean, x.m!.unit)}`,
        share: x.share,
        mean: x.m!.mean
      }))
      .sort((a, b) => b.value - a.value);
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
const totalMean = computed(() => slices.value.reduce((sum, s) => sum + (s.mean ?? 0), 0));
const left = computed(() => (props.panel.mode === 'share' ? measured.value.filter((x) => !x.m || !(x.m.value > 0)).map((x) => x.share) : []));

function remove(share: Share) {
  if (share.key !== undefined) update({ keys: props.panel.keys.filter((k) => k !== share.key) });
  else update({ groups: props.panel.groups.filter((_, i) => i !== share.group) });
}

const hovered = ref<number | null>(null);

const percent = (value: number) => sharePercent(value, total.value);
const measures: { id: PieMeasure; label: string }[] = [
  { id: 'charge', label: 'As they are: amp-seconds, for currents' },
  { id: 'energy', label: 'Energy: times a voltage, in watt-hours' }
];
</script>

<template>
  <div class="pie-panel">
    <div v-if="editing" class="panel-settings">
      <label>
        <span class="hint small">Name</span>
        <input :value="panel.title" maxlength="120" placeholder="Its tab's name" aria-label="Pie's name"
          @change="update({ title: ($event.target as HTMLInputElement).value.trim() })" />
      </label>
      <label>
        <span class="hint small">Slices</span>
        <select :value="panel.mode" aria-label="What the slices are" @change="setMode(($event.target as HTMLSelectElement).value as PieMode)">
          <option value="share">Each signal's share of the total</option>
          <option value="states">Time at each value of one signal</option>
        </select>
      </label>
      <template v-if="panel.mode === 'share'">
        <label>
          <span class="hint small">Adding up the signals</span>
          <select :value="panel.measure" aria-label="What the slices add up" @change="update({ measure: ($event.target as HTMLSelectElement).value as PieMeasure })">
            <option v-for="m in measures" :key="m.id" :value="m.id">{{ m.label }}</option>
          </select>
        </label>
        <label v-if="panel.measure === 'energy'">
          <span class="hint small">Times the voltage</span>
          <select :value="panel.voltage" aria-label="Voltage" @change="update({ voltage: ($event.target as HTMLSelectElement).value })">
            <option value="">Each current's own (…Voltage beside …Current)</option>
            <option v-for="s in numbers.filter((n) => n.unit === 'V')" :key="s.key" :value="s.key">{{ labelOf(s.key) }}</option>
          </select>
        </label>
      </template>
    </div>
    <div class="pie-tools">
      <select v-if="panel.mode === 'share' && !full" value="" aria-label="Add a signal"
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
      <PieChart v-model:hovered="hovered" :slices="slices" />
      <table class="plain legend">
        <tbody>
          <tr v-for="(slice, i) in slices" :key="slice.label" :class="{ dim: hovered !== null && hovered !== i }"
            :title="slice.share?.keys.join('\n')" @mouseenter="hovered = i" @mouseleave="hovered = null">
            <td><span class="swatch" :style="{ background: slice.color }"></span></td>
            <td class="name">
              {{ slice.label }}
              <span v-if="(slice.share?.keys.length ?? 0) > 1" class="hint">{{ slice.share!.keys.length }} signals</span>
            </td>
            <td class="number">{{ percent(slice.value) }}</td>
            <td class="number hint">{{ slice.note }}</td>
            <td v-if="slice.share">
              <button class="remove" :aria-label="`Remove ${slice.label}`" @click="remove(slice.share)">✕</button>
            </td>
          </tr>
        </tbody>
        <tfoot v-if="panel.mode === 'share'">
          <tr class="total">
            <td></td>
            <td class="name">Total</td>
            <td class="number">100%</td>
            <td class="number">{{ energy ? `${formatNumber(total, 'Wh')} · ${formatNumber(totalMean, 'W')}` : `mean ${formatNumber(totalMean, slices[0]?.share ? (byKey.get(slices[0].share.keys[0])?.unit ?? '') : '')}` }}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
    <p v-else-if="panel.keys.length && panel.mode === 'states'" class="hint small">No values in the span shown.</p>
    <p v-else-if="shares.length === 0 || panel.mode === 'states'" class="hint small">
      {{ panel.mode === 'share' ? 'Add numbers to compare: motor currents, say.' : 'Choose a state, mode or zone to see how long it spent at each.' }}
      Or drag one here from the signal list.
    </p>
    <div v-if="left.length" class="left-out">
      <span class="hint small">{{ energy ? 'No values (or no voltage beside them), or none drawn, in the span:' : 'None, or below zero, in the span:' }}</span>
      <span v-for="share in left" :key="share.label" class="left-key small">
        {{ share.label }}
        <button class="remove" :aria-label="`Remove ${share.label}`" @click="remove(share)">✕</button>
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

.dim {
  opacity: 0.45;
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

.legend .total td {
  border-top: 2px solid rgba(127, 127, 127, 0.5);
  font-weight: 600;
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
