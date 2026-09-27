<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { maxPinLength, minPinLength } from '@/lib/constants';

const emit = defineEmits<{ submit: [pin: string] }>();
defineProps<{ error?: string | null; busy?: boolean }>();

const pin = ref('');
const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];

function press(key: string) {
  if (key === 'clear') pin.value = '';
  else if (key === 'back') pin.value = pin.value.slice(0, -1);
  else if (pin.value.length < maxPinLength) pin.value += key;
}

function submit() {
  if (pin.value.length < minPinLength) return;
  emit('submit', pin.value);
  pin.value = '';
}

// Physical keyboards work too (laptop kiosks).
function onKeydown(event: KeyboardEvent) {
  if (/^\d$/.test(event.key)) press(event.key);
  else if (event.key === 'Backspace') press('back');
  else if (event.key === 'Escape') press('clear');
  else if (event.key === 'Enter') submit();
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div class="pin-pad">
    <div class="pin-display" aria-live="polite">
      <span v-for="i in Math.max(pin.length, minPinLength)" :key="i" class="pin-dot" :class="{ filled: i <= pin.length }"></span>
    </div>
    <p v-if="error" class="error-text">{{ error }}</p>
    <div class="keys">
      <button v-for="key in keys" :key="key" class="key" :class="{ small: key.length > 1 }" :disabled="busy" @click="press(key)">
        {{ key === 'back' ? '⌫' : key === 'clear' ? 'Clear' : key }}
      </button>
    </div>
    <button class="enter" :disabled="busy || pin.length < minPinLength" @click="submit">Enter</button>
  </div>
</template>

<style scoped>
.pin-pad {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.pin-display {
  display: flex;
  gap: 12px;
  min-height: 20px;
}

.pin-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid var(--primary-text-color);
  opacity: 0.6;
}

.pin-dot.filled {
  background: var(--primary-text-color);
  opacity: 1;
}

.keys {
  display: grid;
  grid-template-columns: repeat(3, 72px);
  gap: 12px;
}

.key,
.enter {
  height: 72px;
  border: none;
  border-radius: 12px;
  background: var(--accent-color);
  color: var(--primary-text-color);
  font: inherit;
  font-size: 1.6rem;
  cursor: pointer;
  touch-action: manipulation;
}

.key.small {
  font-size: 1rem;
}

.key:active,
.enter:active {
  filter: brightness(1.3);
}

.enter {
  width: calc(72px * 3 + 24px);
  height: 56px;
  font-size: 1.1rem;
  background: var(--header-color);
  color: var(--header-text-color);
}

.enter:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
