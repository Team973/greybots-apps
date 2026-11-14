<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { StageChoice, TicketStatus } from '@/lib/tickets';

// The ticket's stage as a pill in its colour. With choices, clicking it opens
// a menu of only the stages it can move to; clicking anywhere else (or Escape)
// closes it without changing anything. Without choices it's just the pill.
const props = defineProps<{ status: TicketStatus; label: string; choices: StageChoice[] }>();
const emit = defineEmits<{ pick: [to: TicketStatus] }>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const button = ref<HTMLButtonElement | null>(null);
const items = ref<HTMLButtonElement[]>([]);

function onPointerDown(event: PointerEvent) {
  if (root.value && !root.value.contains(event.target as Node)) open.value = false;
}
watch(open, async (isOpen) => {
  if (isOpen) {
    document.addEventListener('pointerdown', onPointerDown, true);
    await nextTick();
    items.value[0]?.focus();
  } else {
    document.removeEventListener('pointerdown', onPointerDown, true);
  }
});
onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown, true));

function close(refocus = true) {
  open.value = false;
  if (refocus) button.value?.focus();
}
function pick(to: TicketStatus) {
  close(false);
  emit('pick', to);
}
function onKeydown(event: KeyboardEvent) {
  if (!open.value) return;
  const i = items.value.indexOf(document.activeElement as HTMLButtonElement);
  if (event.key === 'Escape') close();
  else if (event.key === 'ArrowDown') items.value[(i + 1) % items.value.length]?.focus();
  else if (event.key === 'ArrowUp') items.value[(i - 1 + items.value.length) % items.value.length]?.focus();
  else if (event.key === 'Tab') close(false);
  else return;
  if (event.key !== 'Tab') event.preventDefault();
}
</script>

<template>
  <div ref="root" class="stage-menu" :class="`stage-${props.status}`" @keydown="onKeydown">
    <button
      v-if="choices.length"
      ref="button"
      type="button"
      class="pill"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-label="`Stage: ${label}. Change stage`"
      @click="open = !open"
    >
      {{ label }}<span class="caret" aria-hidden="true">▾</span>
    </button>
    <span v-else class="pill static">{{ label }}</span>

    <div v-if="open" class="menu" role="menu" :aria-label="`Move from ${label} to`">
      <button
        v-for="choice in choices"
        :key="choice.to"
        ref="items"
        type="button"
        role="menuitem"
        class="item"
        :class="`to-${choice.to}`"
        @click="pick(choice.to)"
      >
        <span class="swatch" aria-hidden="true"></span>{{ choice.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.stage-menu {
  --stage: var(--stage-open);
  position: relative;
  display: inline-flex;
}

.stage-menu.stage-in_progress {
  --stage: var(--stage-in_progress);
}

.stage-menu.stage-overdue {
  --stage: var(--stage-overdue);
}

.stage-menu.stage-closed {
  --stage: var(--stage-closed);
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 999px;
  border: 2px solid var(--stage);
  background: color-mix(in srgb, var(--stage) 16%, transparent);
  color: var(--primary-text-color);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.pill.static {
  cursor: default;
}

.pill:focus-visible {
  outline: 2px solid var(--stage);
  outline-offset: 2px;
}

.caret {
  color: var(--stage);
}

.menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  min-width: 220px;
  padding: 6px;
  border-radius: 10px;
  border: 1px solid rgba(128, 128, 128, 0.35);
  background: var(--tile-background-color);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}

.item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--primary-text-color);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.item:hover,
.item:focus-visible {
  background: rgba(128, 128, 128, 0.16);
  outline: none;
}

.swatch {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--stage-open);
}

.to-in_progress .swatch {
  background: var(--stage-in_progress);
}

.to-overdue .swatch {
  background: var(--stage-overdue);
}

.to-closed .swatch {
  background: var(--stage-closed);
}
</style>
