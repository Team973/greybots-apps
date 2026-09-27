<script setup lang="ts">
import { ref } from 'vue';
import PinPad from './PinPad.vue';
import type { KioskUser } from '@/lib/db';
import { listKioskUsers } from '@/lib/kiosk-users';
import { useLiveQuery } from '@/lib/live-query';
import { roleLabel } from '@/lib/roles';
import { useSessionStore } from '@/stores/session-store';

const emit = defineEmits<{ 'signed-in': [] }>();
const session = useSessionStore();

const users = useLiveQuery(listKioskUsers, []);
const selected = ref<KioskUser | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);

function select(user: KioskUser | null) {
  selected.value = user;
  error.value = null;
}

async function submit(pin: string) {
  if (!selected.value) return;
  busy.value = true;
  try {
    if (await session.signInKiosk(selected.value.id, pin)) emit('signed-in');
    else error.value = 'Incorrect PIN';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="!selected" class="user-grid">
    <button v-for="user in users" :key="user.id" class="user-tile" @click="select(user)">
      <span class="name">{{ user.name }}</span>
      <span class="role">{{ roleLabel(user.role) }}</span>
    </button>
  </div>
  <div v-else class="pin-entry">
    <h2>{{ selected.name }}</h2>
    <PinPad :error="error" :busy="busy" @submit="submit" />
    <button class="back" @click="select(null)">Not {{ selected.name }}?</button>
  </div>
</template>

<style scoped>
.user-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 16px;
  width: 100%;
  max-width: 900px;
}

.user-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 24px 12px;
  border: none;
  border-radius: 12px;
  background: var(--tile-background-color);
  color: var(--primary-text-color);
  font: inherit;
  cursor: pointer;
  touch-action: manipulation;
}

.user-tile:hover {
  outline: 2px solid var(--header-color);
}

.name {
  font-size: 1.2rem;
  font-weight: 500;
}

.role {
  opacity: 0.7;
  font-size: 0.85rem;
}

.pin-entry {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.back {
  margin-top: 16px;
  border: none;
  background: none;
  color: var(--primary-text-color);
  opacity: 0.7;
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}
</style>
