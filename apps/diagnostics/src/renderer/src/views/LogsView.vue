<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import '@material/web/button/filled-button';

import type { OffloadedFiles } from '@shared/ipc';
import { describeMatch, type OffloadStatus } from '@shared/offload';
import { formatBytes, formatTime } from '@/format';

// The main process does the offloading, and doesn't tell the window as it
// goes; the window asks this often while the page is open.
const refreshMs = 1000;

const status = ref<OffloadStatus | null>(null);
const files = ref<OffloadedFiles | null>(null);
const startMessage = ref('');
let timer: ReturnType<typeof setInterval> | undefined;

const progressPercent = computed(() => {
  const current = status.value?.current;
  return current && current.bytesTotal > 0 ? Math.floor((current.bytesDone / current.bytesTotal) * 100) : 0;
});

const sourceNames: Record<string, string> = {
  roborio: 'roboRIO',
  'driver-station': 'Driver Station',
  'ctre-hoot': 'CTRE Hoot'
};

function fileName(localPath: string): string {
  return localPath.slice(localPath.lastIndexOf('/') + 1);
}

async function refresh() {
  const wasRunning = status.value?.running ?? false;
  status.value = await window.diagnostics.getOffloadStatus();
  // The list only changes when a run finishes (or one has just started).
  if (wasRunning !== status.value.running || files.value === null) {
    files.value = await window.diagnostics.getOffloadedFiles();
  }
}

async function offloadNow() {
  startMessage.value = '';
  const offload = window.diagnostics.startOffload();
  // Shows the run as started straight away rather than at the next refresh.
  await refresh();
  startMessage.value = await offload;
  await refresh();
}

onMounted(() => {
  refresh();
  timer = setInterval(refresh, refreshMs);
});

onUnmounted(() => clearInterval(timer));
</script>

<template>
  <section class="card">
    <h2>Offload</h2>
    <template v-if="status">
      <p v-if="status.robotHost" id="robot-status" class="success-text">Robot connected at {{ status.robotHost }}.</p>
      <p v-else id="robot-status" class="hint">No robot connected.</p>
      <p class="hint">
        <template v-if="status.autoOffload">Logs are pulled automatically when the robot connects.</template>
        <template v-else>Automatic offload is off in Settings.</template>
        Logs already on this computer aren't pulled again.
      </p>

      <div v-if="status.current" id="offload-progress" class="progress">
        <div>
          {{ status.current.label }}: {{ status.current.filesDone }} of {{ status.current.filesTotal }} files,
          {{ formatBytes(status.current.bytesDone) }} of {{ formatBytes(status.current.bytesTotal) }}
        </div>
        <progress :value="progressPercent" max="100"></progress>
        <div v-for="name in status.current.active" :key="name" class="hint path">{{ name }}</div>
      </div>

      <div class="card-actions">
        <md-filled-button id="offload-now" :disabled="status.running" @click="offloadNow">
          {{ status.running ? 'Offloading…' : 'Offload now' }}
        </md-filled-button>
        <span v-if="startMessage" class="error-text">{{ startMessage }}</span>
      </div>

      <div v-if="status.lastRun && !status.running" id="last-run">
        <p>
          Last offload {{ formatTime(status.lastRun.finishedAt) }}{{ status.lastRun.automatic ? ' (automatic)' : '' }}:
          {{ status.lastRun.copied }} copied ({{ formatBytes(status.lastRun.bytes) }}),
          {{ status.lastRun.skipped }} already here.
        </p>
        <p v-for="error in status.lastRun.errors" :key="error" class="error-text">{{ error }}</p>
      </div>
    </template>
  </section>

  <section class="card">
    <h2>Offloaded logs</h2>
    <template v-if="files">
      <p v-if="files.total === 0" class="hint">Nothing offloaded yet.</p>
      <template v-else>
        <p class="hint">
          {{ files.total }} {{ files.total === 1 ? 'file' : 'files' }}.
          <template v-if="files.total > files.recent.length">The newest {{ files.recent.length }} are shown.</template>
        </p>
        <table class="plain" id="offloaded-files">
          <thead>
            <tr>
              <th>File</th>
              <th>From</th>
              <th>Match</th>
              <th>Last changed</th>
              <th>Size</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="file in files.recent" :key="file.localPath">
              <td class="path" :title="file.localPath">{{ fileName(file.localPath) }}</td>
              <td>{{ sourceNames[file.source] ?? file.source }}</td>
              <td>{{ file.match ? describeMatch(file.match) : '' }}</td>
              <td>{{ formatTime(file.modified) }}</td>
              <td class="number">{{ formatBytes(file.size) }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </template>
  </section>
</template>

<style scoped>
.progress {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

progress {
  width: 100%;
}
</style>
