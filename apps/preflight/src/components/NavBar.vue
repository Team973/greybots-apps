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
    <!-- The page links scroll sideways when they don't all fit, so the sync
         status and Lock are always in reach. -->
    <nav class="links" aria-label="Pages">
      <RouterLink to="/" class="nav-button" exact-active-class="router-link-active" active-class="">Overview</RouterLink>
      <RouterLink v-if="session.hasRole('member')" to="/schedule" class="nav-button">Schedule</RouterLink>
      <RouterLink v-if="session.hasRole('member')" to="/checklists" class="nav-button">Checklists</RouterLink>
      <RouterLink v-if="session.hasRole('member')" to="/repairs" class="nav-button">Repairs</RouterLink>
      <RouterLink v-if="session.hasRole('member')" to="/batteries" class="nav-button">Batteries</RouterLink>
      <RouterLink v-if="session.hasRole('member')" to="/notes" class="nav-button">Notes</RouterLink>
      <RouterLink v-if="session.hasRole('member')" to="/display" class="nav-button">Display</RouterLink>
      <RouterLink v-if="session.hasRole('lead')" to="/pit-setup" class="nav-button">Pit setup</RouterLink>
      <RouterLink to="/settings" class="nav-button">Settings</RouterLink>
    </nav>
    <SyncStatusChip />
    <span v-if="session.user" class="user">
      {{ session.user.name }} <span class="role">{{ roleLabel(session.user.role) }}</span>
    </span>
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

.links {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.links::-webkit-scrollbar {
  display: none;
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
  padding: 8px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-decoration: none;
  white-space: nowrap;
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

/* The name gives way to the page links first. */
@media (max-width: 1400px) {
  .user {
    display: none;
  }
}
</style>
