<script setup lang="ts">
import { ref } from 'vue';
import TextInput from '@greybots/common/components/TextInput.vue';
import '@material/web/button/filled-button';
import '@material/web/button/text-button';
import type { KioskUser } from '@/lib/db';
import { createKioskUser, listKioskUsers, removeKioskUser, setKioskPin, setKioskRole, validatePin } from '@/lib/kiosk-users';
import { useLiveQuery } from '@/lib/live-query';
import { kioskRoles, roleLabel, type KioskRole } from '@/lib/roles';
import { useSessionStore } from '@/stores/session-store';

const session = useSessionStore();
const users = useLiveQuery(listKioskUsers, []);

const newName = ref('');
const newRole = ref<KioskRole>('member');
const newPin = ref('');
const error = ref<string | null>(null);
const pinResetFor = ref<string | null>(null);
const resetPin = ref('');

async function run(action: () => Promise<unknown>) {
  error.value = null;
  try {
    await action();
    await session.reloadKioskUser();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

function addUser() {
  return run(async () => {
    await createKioskUser(newName.value, newRole.value, newPin.value);
    newName.value = '';
    newPin.value = '';
    newRole.value = 'member';
  });
}

function changeRole(user: KioskUser, event: Event) {
  const role = (event.target as HTMLSelectElement).value as KioskRole;
  return run(() => setKioskRole(user.id, role));
}

function savePin(user: KioskUser) {
  const pinError = validatePin(resetPin.value);
  if (pinError) return (error.value = pinError);
  return run(async () => {
    await setKioskPin(user.id, resetPin.value);
    pinResetFor.value = null;
    resetPin.value = '';
  });
}

function remove(user: KioskUser) {
  if (!confirm(`Remove ${user.name} from this device?`)) return;
  return run(() => removeKioskUser(user.id));
}
</script>

<template>
  <div class="card">
    <h2>Crew members</h2>
    <p class="hint">Local accounts for signing in to this device. They are not synced to other devices.</p>

    <ul class="crew-list">
      <li v-for="user in users" :key="user.id">
        <span class="name">{{ user.name }}</span>
        <select :value="user.role" @change="changeRole(user, $event)">
          <option v-for="role in kioskRoles" :key="role" :value="role">{{ roleLabel(role) }}</option>
        </select>
        <template v-if="pinResetFor === user.id">
          <TextInput v-model="resetPin" label="New PIN" type="password" />
          <md-text-button @click="savePin(user)">Save</md-text-button>
          <md-text-button @click="pinResetFor = null">Cancel</md-text-button>
        </template>
        <template v-else>
          <md-text-button @click="pinResetFor = user.id; resetPin = ''">Reset PIN</md-text-button>
          <md-text-button @click="remove(user)">Remove</md-text-button>
        </template>
      </li>
    </ul>

    <h3>Add crew member</h3>
    <div class="form-row">
      <TextInput v-model="newName" label="Name" />
      <TextInput v-model="newPin" label="PIN" type="password" />
      <select v-model="newRole">
        <option v-for="role in kioskRoles" :key="role" :value="role">{{ roleLabel(role) }}</option>
      </select>
      <md-filled-button @click="addUser">Add</md-filled-button>
    </div>
    <p v-if="error" class="error-text">{{ error }}</p>
  </div>
</template>

<style scoped>
.crew-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.crew-list li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.name {
  flex: 1 1 120px;
  font-weight: 500;
}

h3 {
  margin: 8px 0 0;
  font-size: 1rem;
}

select {
  padding: 8px;
  border-radius: 6px;
  background: var(--background-color);
  color: var(--primary-text-color);
  border: 1px solid var(--accent-color);
  font: inherit;
}
</style>
