<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';

import { maxPanels, panelLabels, panelTitle, type PanelType, type PlotPanel } from '@shared/plots';

// The chart's tabs (#144): the line chart's, then a tab for each other plot
// open, which can be closed. + opens another, picked from a menu.

const props = defineProps<{
  panels: PlotPanel[];
  // 'line', or a plot's id.
  active: string;
}>();

const emit = defineEmits<{
  select: [id: string];
  add: [type: PanelType];
  close: [id: string];
}>();

const types: PanelType[] = ['line', 'field', 'console', 'pie', 'robot3d'];
const full = computed(() => props.panels.length >= maxPanels);

// Two of a kind are told apart by number: Pie: shares, Pie: shares 2; the
// first line chart's tab is "Line chart", so another is "Line chart 2".
const titles = computed(() => {
  const seen = new Map<string, number>([[panelLabels.line, 1]]);
  return props.panels.map((panel) => {
    const title = panelTitle(panel);
    const n = (seen.get(title) ?? 0) + 1;
    seen.set(title, n);
    return n === 1 ? title : `${title} ${n}`;
  });
});

const menuOpen = ref(false);
const root = ref<HTMLElement | null>(null);

function pick(type: PanelType) {
  menuOpen.value = false;
  emit('add', type);
}

function onOutside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) menuOpen.value = false;
}
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') menuOpen.value = false;
}
watch(menuOpen, (open) => {
  if (open) {
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('keydown', onKey);
  } else {
    document.removeEventListener('pointerdown', onOutside);
    document.removeEventListener('keydown', onKey);
  }
});
onUnmounted(() => {
  document.removeEventListener('pointerdown', onOutside);
  document.removeEventListener('keydown', onKey);
});

// Arrow keys move between tabs, as in any tab list.
function onTabKey(event: KeyboardEvent) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  const ids = ['line', ...props.panels.map((p) => p.id)];
  const at = ids.indexOf(props.active);
  const next = ids[(at + (event.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
  emit('select', next);
  (root.value?.querySelector(`[data-tab="${next}"]`) as HTMLElement | null)?.focus();
}
</script>

<template>
  <div ref="root" class="plot-tabs">
    <div class="tab-list" role="tablist" aria-label="Plots" @keydown="onTabKey">
      <button class="tab" role="tab" data-tab="line" :aria-selected="active === 'line'" :tabindex="active === 'line' ? 0 : -1"
        @click="emit('select', 'line')">
        Line chart
      </button>
      <div v-for="(panel, i) in panels" :key="panel.id" class="tab closable" :class="{ selected: active === panel.id }">
        <button class="tab-name" role="tab" :data-tab="panel.id" :aria-selected="active === panel.id" :tabindex="active === panel.id ? 0 : -1"
          @click="emit('select', panel.id)">
          {{ titles[i] }}
        </button>
        <button class="tab-close" :aria-label="`Close ${titles[i]}`" title="Close" @click="emit('close', panel.id)">✕</button>
      </div>
    </div>
    <div class="add">
      <button id="add-plot" class="add-button" :disabled="full" :aria-expanded="menuOpen" aria-haspopup="menu"
        :title="full ? `At most ${maxPanels} plots can be open beside the chart` : 'Open another plot'" aria-label="Open another plot"
        @click="menuOpen = !menuOpen">
        <!-- Material's add icon. -->
        <svg viewBox="0 -960 960 960" width="20" height="20" aria-hidden="true">
          <path d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z" />
        </svg>
      </button>
      <div v-if="menuOpen" class="menu" role="menu">
        <button v-for="type in types" :id="`add-${type}`" :key="type" role="menuitem" @click="pick(type)">{{ panelLabels[type] }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.plot-tabs {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  border-bottom: 1px solid rgba(127, 127, 127, 0.35);
}

.tab-list {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  min-width: 0;
}

.tab,
.tab-name,
.tab-close {
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.tab {
  display: flex;
  align-items: center;
  padding: 6px 12px;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  border-radius: 6px 6px 0 0;
  opacity: 0.75;
}

.tab.closable {
  padding: 0 4px 0 0;
}

.tab-name {
  padding: 6px 4px 6px 12px;
}

.tab-close {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  font-size: 0.75rem;
  opacity: 0.6;
}

.tab-close:hover {
  background: rgba(127, 127, 127, 0.2);
  opacity: 1;
}

.tab:hover {
  background: rgba(127, 127, 127, 0.1);
  opacity: 1;
}

.tab[aria-selected='true'],
.tab.selected {
  border-bottom-color: #2a78d6;
  opacity: 1;
  font-weight: 600;
}

.add {
  position: relative;
  padding-bottom: 3px;
}

.add-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid rgba(127, 127, 127, 0.6);
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.add-button svg {
  fill: currentColor;
}

.add-button:hover:not(:disabled) {
  background: rgba(127, 127, 127, 0.15);
}

.add-button:disabled {
  opacity: 0.4;
  cursor: default;
}

.menu {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  min-width: 150px;
  margin-top: 4px;
  padding: 4px;
  border: 1px solid rgba(127, 127, 127, 0.4);
  border-radius: 8px;
  background: var(--tile-background-color, Canvas);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
}

.menu button {
  padding: 7px 10px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.menu button:hover,
.menu button:focus-visible {
  background: rgba(127, 127, 127, 0.15);
}
</style>
