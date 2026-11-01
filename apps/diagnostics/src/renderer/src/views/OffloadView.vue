<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import '@material/web/button/filled-button';
import '@material/web/button/outlined-button';
import NumberInput from '@greybots/common/components/Number.vue';
import Switch from '@greybots/common/components/Switch.vue';
import TextInput from '@greybots/common/components/TextInput.vue';

import type { ConnectionReport } from '@shared/ipc';
import type { OffloadStatus } from '@shared/offload';
import { robotAddresses } from '@shared/robot-address';
import SaveStatus from '@/components/SaveStatus.vue';
import { formatBytes, formatTime } from '@/format';
import { useSettingsDraft } from '@/settings-draft';

// The robot: how to reach it (saved as it's changed), whether it's there,
// and pulling its logs.

const { draft, errors, saveState, edit, typed } = useSettingsDraft();
const manual = computed(() => draft.value.addressMode === 'manual');
const addresses = computed(() => robotAddresses(draft.value));

const report = ref<ConnectionReport | null>(null);
const checking = ref(false);

async function checkConnection() {
  checking.value = true;
  try {
    report.value = await window.diagnostics.checkConnection();
  } finally {
    checking.value = false;
  }
}

// The main process does the offloading, and doesn't tell the window as it
// goes; the window asks this often while the page is open.
const refreshMs = 1000;

const status = ref<OffloadStatus | null>(null);
const startMessage = ref('');
let timer: ReturnType<typeof setInterval> | undefined;

const filesLeft = computed(() => {
  const current = status.value?.current;
  return current ? current.filesTotal - current.filesDone : 0;
});

// Download speed, in bytes a second, from how far the byte count moved
// between refreshes, smoothed so it doesn't jump about.
const speed = ref<number | null>(null);
let lastSample: { label: string; bytes: number; time: number } | null = null;

function measureSpeed(current: OffloadStatus['current']) {
  const now = performance.now();
  if (!current || !lastSample || lastSample.label !== current.label || current.bytesDone < lastSample.bytes) {
    speed.value = null;
  } else if (now > lastSample.time) {
    const latest = ((current.bytesDone - lastSample.bytes) / (now - lastSample.time)) * 1000;
    speed.value = speed.value === null ? latest : 0.7 * speed.value + 0.3 * latest;
  }
  lastSample = current ? { label: current.label, bytes: current.bytesDone, time: now } : null;
}

function runSeconds(run: NonNullable<OffloadStatus['lastRun']>): number {
  return Math.max(0, Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000));
}

async function refresh() {
  status.value = await window.diagnostics.getOffloadStatus();
  measureSpeed(status.value.current);
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
    <h2>Robot</h2>
    <template v-if="status">
      <p v-if="status.robotHost" id="robot-status" class="success-text">Robot connected at {{ status.robotHost }}.</p>
      <p v-else id="robot-status" class="hint">No robot connected.</p>
    </template>

    <div class="field-row">
      <NumberInput id="team-number" :model-value="draft.teamNumber" label="Team number"
        @update:model-value="typed({ teamNumber: $event })"></NumberInput>
    </div>
    <p v-if="errors.teamNumber" class="error-text">{{ errors.teamNumber }}</p>

    <div class="field-row">
      <div>
        Use a set address
        <p class="hint">For a robot that isn't at its usual team address, or a simulator.</p>
      </div>
      <Switch id="manual-address-switch" :model-value="manual"
        @update:model-value="edit({ addressMode: $event ? 'manual' : 'team' })"></Switch>
    </div>

    <template v-if="manual">
      <TextInput id="manual-address" :model-value="draft.manualAddress" label="IP address or hostname"
        @update:model-value="typed({ manualAddress: $event })"></TextInput>
      <p v-if="errors.manualAddress" class="error-text">{{ errors.manualAddress }}</p>
    </template>

    <div class="field-row">
      <div>
        Find the robot by mDNS
        <p class="hint">Looks for the robot by its name on the network, as well as its address.</p>
      </div>
      <Switch id="mdns-switch" :model-value="draft.mdnsEnabled"
        @update:model-value="edit({ mdnsEnabled: $event })"></Switch>
    </div>
    <SaveStatus id="connection-saved" :state="saveState" />

    <p class="hint">The robot is looked for at:</p>

    <table class="plain">
      <tbody>
        <tr v-for="address in addresses" :key="address.host">
          <td>{{ address.label }}</td>
          <td class="path">{{ address.host }}</td>
        </tr>
      </tbody>
    </table>

    <div class="card-actions">
      <md-outlined-button id="check-connection" :disabled="checking" @click="checkConnection">
        {{ checking ? 'Checking…' : 'Check connection' }}
      </md-outlined-button>
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
    <h2>Offload</h2>
    <template v-if="status">
      <p class="hint">
        <template v-if="status.autoOffload">Logs are pulled automatically when the robot connects.</template>
        <template v-else>Automatic offload is off in <RouterLink to="/settings">Settings</RouterLink>.</template>
        Logs already on this computer aren't pulled again. What's been pulled is on the
        <RouterLink to="/storage">Storage</RouterLink> page.
      </p>

      <div v-if="status.current" id="offload-progress" class="progress">
        <div>{{ status.current.label }}</div>
        <label class="bar">
          <span>
            {{ status.current.filesDone }} of {{ status.current.filesTotal }} files
            <span class="hint">({{ filesLeft }} left)</span>
          </span>
          <progress id="files-progress" :value="status.current.filesDone" :max="Math.max(status.current.filesTotal, 1)"></progress>
        </label>
        <label class="bar">
          <span>
            {{ formatBytes(status.current.bytesDone) }} of {{ formatBytes(status.current.bytesTotal) }}
            <span v-if="speed !== null" id="offload-speed" class="hint">({{ formatBytes(speed) }}/s)</span>
          </span>
          <progress id="bytes-progress" :value="status.current.bytesDone" :max="Math.max(status.current.bytesTotal, 1)"></progress>
        </label>
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
          {{ status.lastRun.skipped }} already here<template v-if="status.lastRun.tooOld">,
          {{ status.lastRun.tooOld }} older than the Settings limit not pulled</template>.
          Took {{ runSeconds(status.lastRun) }} s.
        </p>
        <p v-for="error in status.lastRun.errors" :key="error" class="error-text">{{ error }}</p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.progress {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* The count above its bar. */
.bar {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.bar .hint {
  display: inline;
}

progress {
  width: 100%;
}
</style>
