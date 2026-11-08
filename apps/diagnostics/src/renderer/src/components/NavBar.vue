<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { useViewModeStore } from '@greybots/common/stores/view-mode-store';

import type { OffloadStatus } from '@shared/offload';

const viewMode = useViewModeStore();
const toggleTheme = () => viewMode.setThemePreference(viewMode.isDarkMode ? 'light' : 'dark');

// The robot's connection, as the download watcher last found it (it looks
// every 10 s), and whether a download is running or the last one was cut
// off. Asked for every 2 s.
const offload = ref<OffloadStatus | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
async function poll() {
  try {
    offload.value = await window.diagnostics.getOffloadStatus();
  } catch {
    // Asked again next time.
  } finally {
    timer = setTimeout(poll, 2000);
  }
}
poll();
onUnmounted(() => clearTimeout(timer));

const robot = computed(() => {
  const status = offload.value;
  if (!status) return { state: 'unknown', label: 'Robot', title: 'Looking for the robot' };
  if (status.running && status.stage === 'pulling') {
    const job = status.jobs.find((j) => j.label === 'From the robot');
    const count = job && job.filesTotal ? ` ${job.filesDone}/${job.filesTotal}` : '';
    return { state: 'busy', label: `Downloading${count}`, title: `Downloading logs from the robot${status.robotHost ? ` at ${status.robotHost}` : ''}` };
  }
  if (status.robotHost) return { state: 'online', label: 'Robot', title: `Robot connected at ${status.robotHost}` };
  return { state: 'offline', label: 'No robot', title: 'No robot connected (looked for every 10 s)' };
});
// The last download was cut off (the robot went away), until the next.
const interrupted = computed(() => !!offload.value && !offload.value.running && !!offload.value.lastRun?.interrupted);
</script>

<template>
  <header class="nav">
    <span class="brand">Greybots Diagnostics</span>
    <span class="spacer"></span>
    <RouterLink to="/signals" class="nav-button">Signals</RouterLink>
    <RouterLink to="/reports" class="nav-button">Reports</RouterLink>
    <RouterLink to="/import" class="nav-button">Log Import</RouterLink>
    <RouterLink to="/export" class="nav-button">Log Export</RouterLink>
    <RouterLink to="/settings" class="nav-button">Settings</RouterLink>
    <RouterLink id="robot-status" to="/import" class="robot-badge" :class="robot.state" :title="robot.title">
      <span class="dot" aria-hidden="true"></span>{{ robot.label }}<span v-if="interrupted" class="interrupted"> · Download interrupted</span>
    </RouterLink>
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

.robot-badge {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-left: 6px;
  padding: 5px 11px;
  border-radius: 999px;
  /* Darker than the header, not its hover colour: a status, not a page. */
  background-color: rgba(0, 0, 0, 0.22);
  color: inherit;
  font-size: 0.9rem;
  text-decoration: none;
  white-space: nowrap;
}

.robot-badge .dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-color: #9a9a9a;
}

.robot-badge.online .dot,
.robot-badge.busy .dot {
  background-color: #3ab83a;
  box-shadow: 0 0 0 2px rgba(58, 184, 58, 0.35);
}

.robot-badge.busy .dot {
  animation: pulse 1.2s ease-in-out infinite;
}

.robot-badge.offline .dot {
  background-color: #e05050;
  box-shadow: 0 0 0 2px rgba(224, 80, 80, 0.35);
}

.robot-badge .interrupted {
  font-weight: 600;
}

@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .robot-badge.busy .dot {
    animation: none;
  }
}

.theme-button {
  padding: 6px 10px;
  font-size: 1.15rem;
  line-height: 1;
}
</style>
