<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import type { ConsolePanel } from '@shared/plots';
import type { SignalInfo } from '@shared/signals';
import { useSeries } from '@/panel-data';

// What the robot code printed (#144): a data log's `console` (WPILib's
// DataLogManager logs it), or live, the roboRIO's console. Over the span
// shown, with the line at the moment shown marked, and kept in sight.

const props = defineProps<{
  panel: ConsolePanel;
  session: string;
  signals: SignalInfo[];
  time: number;
  span: [number, number];
  // Following live: the newest lines are kept in sight.
  following: boolean;
  editing: boolean;
  // The lines' box, pixels.
  height?: number;
}>();

const emit = defineEmits<{
  update: [panel: ConsolePanel];
  // A line was clicked: its time.
  seek: [time: number];
}>();

const textSignals = computed(() => props.signals.filter((s) => s.kind === 'string' && !s.parent && s.count !== 0));
const found = computed(() => props.signals.some((s) => s.key === props.panel.key));

const keys = computed(() => (props.panel.key ? [props.panel.key] : []));
const { series, error } = useSeries(computed(() => props.session), keys, computed(() => props.span));

interface Line {
  id: number;
  time: number;
  text: string;
  tone: 'error' | 'warning' | '';
}

const tone = (text: string): Line['tone'] =>
  /\b(error|exception|fatal)\b/i.test(text) ? 'error' : /\bwarn(ing)?\b/i.test(text) ? 'warning' : '';

// One line each: a value can hold several (what was printed between two writes).
const lines = computed<Line[]>(() => {
  const s = series.value.get(props.panel.key);
  if (!s || !Array.isArray(s.values)) return [];
  const out: Line[] = [];
  for (let i = 0; i < s.times.length; i++) {
    const value = s.values[i] as string;
    for (const text of value.replace(/\r/g, '').replace(/\n$/, '').split('\n')) {
      out.push({ id: out.length, time: s.times[i], text, tone: tone(text) });
    }
  }
  return out;
});

const filtered = computed(() => {
  const words = props.panel.filter.trim().toLowerCase();
  return words ? lines.value.filter((line) => line.text.toLowerCase().includes(words)) : lines.value;
});

// The last line at or before the moment shown.
const current = computed(() => {
  let last: Line | null = null;
  for (const line of filtered.value) {
    if (line.time > props.time + 1e-6) break;
    last = line;
  }
  return last;
});

const list = ref<HTMLElement | null>(null);
watch([() => current.value?.id, () => filtered.value.length, () => props.following], async () => {
  await nextTick();
  const box = list.value;
  if (!box) return;
  if (props.following) {
    box.scrollTop = box.scrollHeight;
    return;
  }
  const row = box.querySelector<HTMLElement>('.current');
  if (!row) return;
  // Into sight if it isn't, without moving the page.
  if (row.offsetTop < box.scrollTop || row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight) {
    box.scrollTop = row.offsetTop - box.clientHeight / 2;
  }
});

function setFilter(text: string) {
  emit('update', { ...props.panel, filter: text });
}

const copied = ref(false);
async function copyLines() {
  await navigator.clipboard.writeText(filtered.value.map((l) => `${l.time.toFixed(2)}  ${l.text}`).join('\n'));
  copied.value = true;
  setTimeout(() => { copied.value = false; }, 1500);
}
</script>

<template>
  <div class="console-panel">
    <div v-if="editing" class="panel-settings">
      <label>
        <span class="hint small">Text from</span>
        <select :value="panel.key" aria-label="Console signal" @change="emit('update', { ...panel, key: ($event.target as HTMLSelectElement).value })">
          <option v-if="!found" :value="panel.key">{{ panel.key || 'Choose one' }} (not here)</option>
          <option v-for="s in textSignals" :key="s.key" :value="s.key">{{ s.key }}</option>
        </select>
      </label>
    </div>
    <div class="console-tools">
      <input class="console-filter" type="search" :value="panel.filter" placeholder="Filter lines" aria-label="Filter console lines"
        @input="setFilter(($event.target as HTMLInputElement).value)" />
      <span class="hint small">{{ filtered.length }} of {{ lines.length }} lines</span>
      <span class="spacer"></span>
      <button class="small-button" :disabled="!filtered.length" @click="copyLines">{{ copied ? 'Copied' : 'Copy' }}</button>
    </div>
    <div ref="list" class="console-lines" role="log" :style="{ height: `${Math.max(200, height ?? 300)}px` }">
      <p v-if="!found" class="hint small">
        This log has no <span class="path">{{ panel.key || 'console' }}</span>.
        WPILib's DataLogManager logs what the robot code prints as <span class="path">console</span>; live, it comes from the roboRIO.
      </p>
      <p v-else-if="!lines.length" class="hint small">Nothing printed in the span shown.</p>
      <div v-for="line in filtered" :key="line.id" class="line" :class="[line.tone, { current: line.id === current?.id, later: line.time > time + 1e-6 }]"
        @click="emit('seek', line.time)">
        <span class="time">{{ line.time.toFixed(2) }}</span>
        <span class="text">{{ line.text }}</span>
      </div>
    </div>
    <p v-if="error" class="error-text small">{{ error }}</p>
  </div>
</template>

<style scoped>
.console-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.console-tools {
  display: flex;
  align-items: center;
  gap: 8px;
}

.console-filter {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid rgba(127, 127, 127, 0.6);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
}

.console-lines {
  overflow: auto;
  padding: 4px 0;
  border: 1px solid rgba(127, 127, 127, 0.35);
  border-radius: 6px;
  font-family: ui-monospace, Consolas, Menlo, monospace;
  font-size: 0.8rem;
}

.console-lines > .hint {
  padding: 8px;
}

.line {
  display: flex;
  gap: 10px;
  padding: 1px 8px;
  cursor: pointer;
}

.line:hover {
  background: rgba(127, 127, 127, 0.12);
}

.line .time {
  flex: none;
  min-width: 4.5em;
  text-align: right;
  opacity: 0.6;
}

.line .text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.line.later {
  opacity: 0.5;
}

.line.current {
  background: color-mix(in srgb, #2a78d6 22%, transparent);
}

.line.error .text {
  color: #e5534b;
}

.line.warning .text {
  color: #c98500;
}
</style>
