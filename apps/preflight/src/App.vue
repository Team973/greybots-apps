<script setup lang="ts">
import { computed } from 'vue';
import { RouterView, useRoute, useRouter } from 'vue-router';
import { useViewModeStore } from '@greybots/common/stores/view-mode-store';
import NavBar from '@/components/NavBar.vue';
import UpdateBanner from '@/components/UpdateBanner.vue';
import { useIdleLock } from '@/lib/idle-lock';
import { useDeviceStore } from '@/stores/device-store';
import { useSessionStore } from '@/stores/session-store';

const viewMode = useViewModeStore();
window.addEventListener('resize', () => {
  viewMode.updateScreenWidth(window.innerWidth);
  viewMode.updateScreenHeight(window.innerHeight);
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => viewMode.updateDarkMode());
viewMode.updateDarkMode();

const device = useDeviceStore();
const session = useSessionStore();
const route = useRoute();
const router = useRouter();

const showNav = computed(() => session.isSignedIn && route.meta.requiresAuth !== false);

// Shared kiosk devices lock themselves after a period of inactivity.
useIdleLock(
  () => device.isKiosk && session.isSignedIn,
  () => device.config?.idleLockMinutes ?? 0,
  async () => {
    await session.signOut();
    router.push({ name: 'login' });
  }
);
</script>

<template>
  <NavBar v-if="showNav" />
  <main class="main-content" :class="{ 'no-nav': !showNav }">
    <RouterView />
  </main>
  <UpdateBanner />
</template>
