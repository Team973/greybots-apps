<script setup lang="ts">
import { onMounted } from 'vue';
import { RouterView, useRoute, useRouter } from 'vue-router';
import { useViewModeStore } from '@greybots/common/stores/view-mode-store';

import { liveSessions } from '@shared/live';
import { shortcutFromPress } from '@shared/shortcuts';
import NavBar from '@/components/NavBar.vue';
import { useSettingsStore } from '@/stores/settings-store';

// Light or dark follows the device unless the person picked one (nav bar).
const viewMode = useViewModeStore();
window.addEventListener('resize', () => {
  viewMode.updateScreenWidth(window.innerWidth);
  viewMode.updateScreenHeight(window.innerHeight);
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => viewMode.updateDarkMode());
viewMode.updateDarkMode();

// Shortcuts from any page, as set in Settings (Ctrl+K for the robot's live
// signals, Ctrl+Shift+K for a simulator's, unless changed). The Signals
// page picks the session up from the address.
const router = useRouter();
const route = useRoute();
const settings = useSettingsStore();
onMounted(() => settings.load());
window.addEventListener('keydown', (event) => {
  const pressed = shortcutFromPress(event);
  if (!pressed) return;
  const live = liveSessions.find((session) => settings.settings.shortcuts[session.shortcut] === pressed);
  if (!live) return;
  event.preventDefault();
  router.push({ name: 'signals', query: { session: live.id } });
});
</script>

<template>
  <RouterView v-if="route.meta.bare" />
  <template v-else>
    <NavBar />
    <main class="main-content">
      <RouterView />
    </main>
  </template>
</template>
