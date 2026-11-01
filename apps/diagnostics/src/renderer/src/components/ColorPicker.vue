<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';

// A signal's colour: one of the palette's, or any colour at all.
defineProps<{
  color: string;
  palette: string[];
  label: string;
}>();

const emit = defineEmits<{
  // A palette slot, or '#rrggbb'.
  pick: [choice: number | string];
}>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
// The menu is placed on the page, not in its parent, so a scrolling list
// doesn't cut it off. It closes if the page scrolls under it.
const at = ref({ top: 0, left: 0 });

function onOutside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) open.value = false;
}
function close() {
  open.value = false;
}
// About the menu's height: near the bottom of the window it opens upward.
const menuHeight = 110;
function toggle() {
  const rect = root.value!.getBoundingClientRect();
  const below = rect.bottom + 6 + menuHeight <= window.innerHeight;
  at.value = { top: below ? rect.bottom + 6 : rect.top - 6 - menuHeight, left: rect.left };
  open.value = !open.value;
}
function listen(on: boolean) {
  if (on) {
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
  } else {
    document.removeEventListener('pointerdown', onOutside);
    document.removeEventListener('scroll', close, true);
    window.removeEventListener('resize', close);
  }
}
watch(open, listen);
onUnmounted(() => listen(false));

function pick(choice: number | string) {
  emit('pick', choice);
  open.value = false;
}
</script>

<template>
  <span ref="root" class="color-picker">
    <button class="current" :style="{ background: color }" :title="`Colour of ${label}`" :aria-label="`Colour of ${label}`"
      :aria-expanded="open" @click="toggle"></button>
    <div v-if="open" class="menu" :style="{ top: `${at.top}px`, left: `${at.left}px` }">
      <div class="choices">
        <button v-for="(choice, slot) in palette" :key="slot" class="choice" :class="{ chosen: choice === color }"
          :style="{ background: choice }" :aria-label="`Colour ${slot + 1}`" @click="pick(slot)"></button>
      </div>
      <label class="custom">
        <span>Other</span>
        <input type="color" :value="color" @change="pick(($event.target as HTMLInputElement).value)" />
      </label>
    </div>
  </span>
</template>

<style scoped>
.color-picker {
  position: relative;
  display: inline-block;
}

.current {
  display: block;
  width: 14px;
  height: 14px;
  padding: 0;
  border: none;
  border-radius: 3px;
  cursor: pointer;
}

.menu {
  position: fixed;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border-radius: 8px;
  background: var(--tile-background-color);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
}

.choices {
  display: grid;
  grid-template-columns: repeat(4, 22px);
  gap: 6px;
}

.choice {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 4px;
  cursor: pointer;
}

.choice.chosen {
  outline: 2px solid currentColor;
  outline-offset: 1px;
}

.custom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.8rem;
}

.custom input {
  width: 40px;
  height: 22px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
}
</style>
