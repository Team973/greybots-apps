<script setup lang="ts">
import { RouterLink, useRouter } from 'vue-router';
import SyncStatusChip from './SyncStatusChip.vue';
import { roleLabel } from '@/lib/roles';
import { useDeviceStore } from '@/stores/device-store';
import { useSessionStore } from '@/stores/session-store';

const device = useDeviceStore();
const session = useSessionStore();
const router = useRouter();

async function signOut() {
  await session.signOut();
  router.push({ name: 'login' });
}
</script>

<template>
  <header class="nav">
    <RouterLink to="/" class="brand">Preflight</RouterLink>
    <SyncStatusChip />
    <span class="spacer"></span>
    <span v-if="session.user" class="user">
      {{ session.user.name }} <span class="role">{{ roleLabel(session.user.role) }}</span>
    </span>
    <RouterLink to="/" class="nav-button" exact-active-class="router-link-active" active-class="">Overview</RouterLink>
    <RouterLink v-if="session.hasRole('member')" to="/schedule" class="nav-button">Schedule</RouterLink>
    <RouterLink v-if="session.hasRole('member')" to="/repairs" class="nav-button">Repairs</RouterLink>
    <RouterLink v-if="session.hasRole('member')" to="/batteries" class="nav-button">Batteries</RouterLink>
    <RouterLink v-if="session.hasRole('member')" to="/notes" class="nav-button">Notes</RouterLink>
    <RouterLink v-if="session.hasRole('lead')" to="/pit-setup" class="nav-button">Pit setup</RouterLink>
    <RouterLink to="/settings" class="nav-button">Settings</RouterLink>
    <button class="nav-button" @click="signOut">{{ device.isKiosk ? 'Lock' : 'Sign out' }}</button>
  </header>
</template>

<style scoped>
.nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 64px;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  box-sizing: border-box;
  background-color: var(--header-color);
  color: var(--header-text-color);
}

.brand {
  color: inherit;
  text-decoration: none;
  font-size: 1.4rem;
  font-weight: 600;
}

.spacer {
  flex: 1;
}

.user {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.role {
  opacity: 0.75;
  font-size: 0.85rem;
}

.nav-button {
  padding: 8px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-decoration: none;
  cursor: pointer;
}

.nav-button.router-link-active {
  background-color: var(--header-hover-color);
}

.nav-button:hover {
  background-color: var(--header-hover-color);
}

@media print {
  .nav {
    display: none;
  }
}

@media (max-width: 600px) {
  .user {
    display: none;
  }
}
</style>
