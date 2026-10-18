<script setup lang="ts">
import { RouterView, useRoute } from 'vue-router';
import { useViewModeStore } from '@greybots/common/stores/view-mode-store';
import NavBar from '@/components/NavBar.vue';

// Light or dark follows the device unless the person picked one (nav bar).
const viewMode = useViewModeStore();
window.addEventListener('resize', () => {
  viewMode.updateScreenWidth(window.innerWidth);
  viewMode.updateScreenHeight(window.innerHeight);
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => viewMode.updateDarkMode());
viewMode.updateDarkMode();

const route = useRoute();
</script>

<template>
  <NavBar />
  <main class="main-content" :class="{ wide: route.meta.wide }">
    <RouterView />
  </main>
</template>
