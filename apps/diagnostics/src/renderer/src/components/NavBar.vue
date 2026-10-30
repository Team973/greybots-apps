<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { useViewModeStore } from '@greybots/common/stores/view-mode-store';

const viewMode = useViewModeStore();
const toggleTheme = () => viewMode.setThemePreference(viewMode.isDarkMode ? 'light' : 'dark');
</script>

<template>
  <header class="nav">
    <span class="brand">Greybots Diagnostics</span>
    <span class="spacer"></span>
    <RouterLink to="/" class="nav-button">Overview</RouterLink>
    <RouterLink to="/logs" class="nav-button">Logs</RouterLink>
    <RouterLink to="/signals" class="nav-button">Signals</RouterLink>
    <RouterLink to="/settings" class="nav-button">Settings</RouterLink>
    <button
      class="nav-button theme-button"
      :aria-label="viewMode.isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'"
      :title="viewMode.isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'"
      @click="toggleTheme"
    >
      <span aria-hidden="true">{{ viewMode.isDarkMode ? '☀' : '☾' }}</span>
    </button>
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
  gap: 8px;
  padding: 0 16px;
  box-sizing: border-box;
  background-color: var(--header-color);
  color: var(--header-text-color);
}

.brand {
  font-size: 1.4rem;
  font-weight: 600;
}

.spacer {
  flex: 1;
}

.nav-button {
  flex: none;
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

.nav-button:hover,
.nav-button.router-link-exact-active {
  background-color: var(--header-hover-color);
}

.theme-button {
  padding: 6px 10px;
  font-size: 1.15rem;
  line-height: 1;
}
</style>
