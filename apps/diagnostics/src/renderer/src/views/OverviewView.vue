<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import '@material/web/button/filled-button';

import type { AppInfo, ConnectionReport, StorageInfo } from '@shared/ipc';
import { robotAddresses } from '@shared/robot-address';
import { useSettingsStore } from '@/stores/settings-store';

const store = useSettingsStore();

const appInfo = ref<AppInfo | null>(null);
const storage = ref<StorageInfo | null>(null);
const storageMessage = ref('');
const report = ref<ConnectionReport | null>(null);
const checking = ref(false);

const addresses = computed(() => robotAddresses(store.settings));

async function checkConnection() {
  checking.value = true;
  try {
    report.value = await window.diagnostics.checkConnection();
  } finally {
    checking.value = false;
  }
}

async function openFolder() {
  storageMessage.value = await window.diagnostics.openDataDirectory();
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

onMounted(async () => {
  await store.load();
  appInfo.value = await window.diagnostics.getAppInfo();
  storage.value = await window.diagnostics.getStorageInfo();
});
</script>

<template>
  <section class="card">
    <h2>Robot</h2>
    <p v-if="store.settings.addressMode === 'team'" class="hint">
      Team {{ store.settings.teamNumber }}. The robot is looked for at these addresses:
    </p>
    <p v-else class="hint">Using the address set in Settings:</p>

    <table class="plain">
      <tbody>
        <tr v-for="address in addresses" :key="address.host">
          <td>{{ address.label }}</td>
          <td class="path">{{ address.host }}</td>
        </tr>
      </tbody>
    </table>

    <div class="card-actions">
      <md-filled-button id="check-connection" :disabled="checking" @click="checkConnection">
        {{ checking ? 'Checking…' : 'Check connection' }}
      </md-filled-button>
      <template v-if="report && !checking">
        <span v-if="report.reachable" id="connection-result" class="success-text">Robot reached.</span>
        <span v-else id="connection-result" class="error-text">No robot found.</span>
      </template>
    </div>

    <table v-if="report" class="plain">
      <thead>
        <tr>
          <th>Address</th>
          <th>Service</th>
          <th>Result</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="address in report.addresses" :key="address.host">
          <tr v-for="port in address.ports" :key="`${address.host}:${port.port}`">
            <td class="path">{{ address.host }}</td>
            <td>{{ port.service }} ({{ port.port }})</td>
            <td v-if="port.open" class="success-text">Open ({{ port.milliseconds }} ms)</td>
            <td v-else>{{ port.error }}</td>
          </tr>
        </template>
      </tbody>
    </table>
  </section>

  <section class="card">
    <h2>Data on this computer</h2>
    <template v-if="storage">
      <p class="path" id="data-directory">{{ storage.directory }}</p>
      <p v-if="storage.error" class="error-text">This folder can't be used: {{ storage.error }}</p>
      <table v-else class="plain">
        <thead>
          <tr>
            <th>Folder</th>
            <th>What's in it</th>
            <th>Files</th>
            <th>Size</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="folder in storage.folders" :key="folder.name">
            <td class="path">{{ folder.name }}</td>
            <td>{{ folder.purpose }}</td>
            <td class="number">{{ folder.files }}</td>
            <td class="number">{{ formatBytes(folder.bytes) }}</td>
          </tr>
        </tbody>
      </table>
      <div class="card-actions">
        <md-filled-button @click="openFolder">Open folder</md-filled-button>
        <span v-if="storageMessage" class="error-text">{{ storageMessage }}</span>
      </div>
    </template>
  </section>

  <p v-if="appInfo" class="hint">Version {{ appInfo.version }}</p>
</template>
