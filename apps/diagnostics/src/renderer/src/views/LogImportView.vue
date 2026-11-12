<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import '@material/web/button/filled-button';
import '@material/web/button/outlined-button';
import AppDialog from '@greybots/common/components/AppDialog.vue';
import NumberInput from '@greybots/common/components/Number.vue';
import Switch from '@greybots/common/components/Switch.vue';
import TextInput from '@greybots/common/components/TextInput.vue';

import type { ConnectionReport } from '@shared/ipc';
import type { OffloadProgress, OffloadStatus } from '@shared/offload';
import { robotAddresses } from '@shared/robot-address';
import ImportedLogsCard from '@/components/ImportedLogsCard.vue';
import ImportLogsCard from '@/components/ImportLogsCard.vue';
import SaveStatus from '@/components/SaveStatus.vue';
import UsbImportCard from '@/components/UsbImportCard.vue';
import { formatBytes, formatTime, formatWhen } from '@/format';
import { useSettingsDraft } from '@/settings-draft';

// Logs coming in: the robot (how to reach it, saved as it's changed,
// whether it's there, and pulling its logs), files dropped or picked, USB
// drives, and the latest logs brought in.

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

// The main process does the downloading, and doesn't tell the window as it
// goes; the window asks this often while the page is open, and more often
// while a download runs, so its start shows straight away.
const refreshMs = 1000;
const runningRefreshMs = 250;

const status = ref<OffloadStatus | null>(null);
const startMessage = ref('');
let timer: ReturnType<typeof setTimeout> | undefined;

// What the download is doing before files come in.
const stageText = computed(() => {
  const now = status.value;
  if (!now?.running) return '';
  if (now.looking.length) return `Looking for the robot at ${now.looking.join(', ')}…`;
  if (now.stage === 'connecting' && now.robotHost) return `Logging in to the robot at ${now.robotHost}…`;
  return '';
});

function searchText(job: OffloadProgress): string {
  const found = `${job.foldersListed} folder${job.foldersListed === 1 ? '' : 's'} looked in, ${job.filesFound} log${job.filesFound === 1 ? '' : 's'} found, ${job.filesTotal} new`;
  return job.searching ? `Finding logs: ${found}…` : `${found}.`;
}

// Download speed for each part, in bytes a second, from how far its byte
// count moved between refreshes, smoothed so it doesn't jump about.
const speeds = ref(new Map<string, number>());
const lastSamples = new Map<string, { bytes: number; time: number }>();

function measureSpeeds(jobs: OffloadProgress[]) {
  const now = performance.now();
  const next = new Map<string, number>();
  for (const job of jobs) {
    const last = lastSamples.get(job.label);
    const before = speeds.value.get(job.label);
    if (last && job.bytesDone >= last.bytes && now > last.time) {
      const latest = ((job.bytesDone - last.bytes) / (now - last.time)) * 1000;
      next.set(job.label, before === undefined ? latest : 0.7 * before + 0.3 * latest);
    }
    lastSamples.set(job.label, { bytes: job.bytesDone, time: now });
  }
  for (const label of [...lastSamples.keys()]) if (!jobs.some((job) => job.label === label)) lastSamples.delete(label);
  speeds.value = next;
}

function runSeconds(run: NonNullable<OffloadStatus['lastRun']>): number {
  return Math.max(0, Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000));
}

// The latest imported logs, reloaded when a download or import finishes.
const importedLogs = ref<InstanceType<typeof ImportedLogsCard> | null>(null);
const reloadImported = () => importedLogs.value?.reload();

async function refresh() {
  const wasRunning = status.value?.running ?? false;
  status.value = await window.diagnostics.getOffloadStatus();
  if (wasRunning && !status.value.running) reloadImported();
  measureSpeeds(status.value.jobs);
}

function schedule() {
  timer = setTimeout(async () => {
    await refresh().catch(() => {});
    schedule();
  }, status.value?.running ? runningRefreshMs : refreshMs);
}

async function offloadNow(turbo = false) {
  startMessage.value = '';
  errorsOpen.value = false;
  const offload = window.diagnostics.startOffload(turbo);
  // Shows the run as started straight away rather than at the next refresh.
  await refresh();
  startMessage.value = await offload;
  await refresh();
}

// What went wrong with the last download, opened from its failed badge.
const errorsOpen = ref(false);

// --- Turbo download: the robot program paused while it downloads ---
const turboHelp = 'Pauses the robot program while its logs download, so the download has the roboRIO to itself, then lets it go again. ' +
  "Only with the robot disabled and not on a field. Until it's done the robot can't be enabled; rebooting it, Restart Robot Code " +
  'in the Driver Station, or deploying code also starts it again.';
const turboBadges: Record<string, { text: string; kind: string }> = {
  checking: { text: 'Checking the robot is disabled…', kind: 'busy' },
  paused: { text: 'Robot code paused', kind: 'warn' },
  resumed: { text: 'Robot code resumed', kind: 'ok' },
  refused: { text: 'Robot code not paused', kind: 'idle' },
  'resume-failed': { text: 'Robot code still paused', kind: 'bad' }
};
const resumeMessage = ref('');
async function resumeRobotCode() {
  resumeMessage.value = await window.diagnostics.resumeRobotCode();
  await refresh();
}

// --- Clearing the logs just downloaded off the robot (#139) ---
// Asked twice: a button opens the list, and the delete in it only works
// once its box is ticked. The main process checks every file again before
// deleting it (clear.ts) and leaves any that may still be open.
const clearOpen = ref(false);
const clearSure = ref(false);
const clearMessage = ref('');
function openClear() {
  clearSure.value = false;
  clearMessage.value = '';
  clearOpen.value = true;
}
async function clearNow() {
  const clearable = status.value?.clearable;
  if (!clearable || !clearSure.value) return;
  clearMessage.value = await window.diagnostics.clearRobotLogs(clearable.downloadedAt, clearable.files.length)
    .catch((error: Error) => error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  await refresh();
  if (!clearMessage.value) clearOpen.value = false;
}
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

onMounted(async () => {
  await refresh();
  schedule();
});

onUnmounted(() => clearTimeout(timer));
</script>

<template>
  <section class="card">
    <div class="card-head">
      <h2>Robot</h2>
      <template v-if="status">
        <span v-if="status.robotHost" id="robot-status" class="badge ok">Connected at {{ status.robotHost }}</span>
        <span v-else id="robot-status" class="badge idle">No robot</span>
      </template>
    </div>

    <div class="field-row">
      <NumberInput id="team-number" :model-value="draft.teamNumber" label="Team number"
        @update:model-value="typed({ teamNumber: $event })"></NumberInput>
    </div>
    <p v-if="errors.teamNumber" class="error-text">{{ errors.teamNumber }}</p>

    <div class="field-row">
      <span title="For a robot that isn't at its usual team address, or a simulator.">Use a set address</span>
      <Switch id="manual-address-switch" :model-value="manual"
        @update:model-value="edit({ addressMode: $event ? 'manual' : 'team' })"></Switch>
    </div>
    <template v-if="manual">
      <TextInput id="manual-address" :model-value="draft.manualAddress" label="IP address or hostname"
        @update:model-value="typed({ manualAddress: $event })"></TextInput>
      <p v-if="errors.manualAddress" class="error-text">{{ errors.manualAddress }}</p>
    </template>

    <div class="field-row">
      <span title="Looks for the robot by its name on the network, as well as its address.">Find the robot by mDNS</span>
      <Switch id="mdns-switch" :model-value="draft.mdnsEnabled" @update:model-value="edit({ mdnsEnabled: $event })"></Switch>
    </div>
    <SaveStatus id="connection-saved" :state="saveState" />

    <div class="card-actions">
      <md-outlined-button id="check-connection" :disabled="checking" @click="checkConnection">
        {{ checking ? 'Checking…' : 'Check connection' }}
      </md-outlined-button>
      <template v-if="report && !checking">
        <span v-if="report.reachable" id="connection-result" class="badge ok">Robot reached</span>
        <span v-else id="connection-result" class="badge bad">No robot found</span>
      </template>
      <span class="hint small" :title="addresses.map((a) => `${a.label}: ${a.host}`).join('\n')">
        {{ addresses.map((a) => a.host).join(' · ') }}
      </span>
    </div>

    <details v-if="report" class="small">
      <summary>Each address</summary>
      <table class="plain">
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
    </details>
  </section>

  <section class="card">
    <h2 title="Logs already on this computer aren't pulled again. What's come in is under Latest imported logs, below.">Download from Bot</h2>
    <div class="field-row">
      <span title="As soon as the robot connects.">Download automatically</span>
      <Switch id="auto-offload-switch" :model-value="draft.autoOffload" @update:model-value="edit({ autoOffload: $event })"></Switch>
    </div>
    <div class="field-row">
      <span title="Older logs stay on the robot.">Logs from the last</span>
      <NumberInput id="offload-days" :model-value="draft.offloadDays" label="Days (0: all)"
        @update:model-value="typed({ offloadDays: $event })"></NumberInput>
    </div>
    <p v-if="errors.offloadDays" class="error-text">{{ errors.offloadDays }}</p>
    <template v-if="status">

      <p v-if="stageText" id="offload-stage">{{ stageText }}</p>

      <div v-for="job in status.jobs" :key="job.label" class="progress offload-progress">
        <div>{{ job.label }}</div>
        <div class="hint">{{ searchText(job) }}</div>
        <template v-if="job.filesTotal > 0">
          <label class="bar">
            <span>
              {{ job.filesDone }} of {{ job.filesTotal }} files
              <span class="hint">({{ job.filesTotal - job.filesDone }} left{{ job.searching ? ' so far' : '' }})</span>
            </span>
            <progress :value="job.filesDone" :max="Math.max(job.filesTotal, 1)"></progress>
          </label>
          <label class="bar">
            <span>
              {{ formatBytes(job.bytesDone) }} of {{ formatBytes(job.bytesTotal) }}
              <span v-if="speeds.get(job.label) !== undefined" class="hint offload-speed">({{ formatBytes(speeds.get(job.label)!) }}/s)</span>
            </span>
            <progress :value="job.bytesDone" :max="Math.max(job.bytesTotal, 1)"></progress>
          </label>
        </template>
        <div v-for="name in job.active" :key="name" class="hint path">{{ name }}</div>
      </div>

      <div class="card-actions">
        <md-filled-button id="offload-now" :disabled="status.running" @click="offloadNow()">
          {{ status.running ? 'Downloading…' : 'Download now' }}
        </md-filled-button>
        <md-outlined-button id="offload-turbo" :disabled="status.running" :title="turboHelp" @click="offloadNow(true)">Turbo download</md-outlined-button>
        <span v-if="status.running && status.runStartedAt" id="offload-since" class="hint small" :title="formatTime(status.runStartedAt)">since {{ formatWhen(status.runStartedAt) }}</span>
        <span v-if="startMessage" class="error-text">{{ startMessage }}</span>
      </div>

      <div v-if="status.turbo" id="turbo-status" class="badges">
        <span class="badge" :class="turboBadges[status.turbo.state].kind" :title="status.turbo.programs.join(', ')">{{ turboBadges[status.turbo.state].text }}</span>
        <span class="hint small">{{ status.turbo.message }} <span :title="formatTime(status.turbo.at)">({{ formatWhen(status.turbo.at) }})</span></span>
        <md-outlined-button v-if="status.turbo.state === 'resume-failed' && !status.running" id="turbo-resume" @click="resumeRobotCode">Resume robot code</md-outlined-button>
        <span v-if="resumeMessage" class="error-text">{{ resumeMessage }}</span>
      </div>

      <div v-if="status.lastRun && !status.running" id="last-run" class="badges"
        :title="`Last download ${formatTime(status.lastRun.finishedAt)}${status.lastRun.automatic ? ' (automatic)' : ''}: ${formatBytes(status.lastRun.bytes)} in ${runSeconds(status.lastRun)} s`">
        <span v-if="status.lastRun.interrupted" id="interrupted" class="badge bad" title="The rest comes with the next download.">Download interrupted</span>
        <span class="badge ok">{{ status.lastRun.copied }} downloaded</span>
        <span class="badge warn">{{ status.lastRun.skipped }} already here</span>
        <span v-if="status.lastRun.tooOld" class="badge idle" title="Older than the days set above: left on the robot.">{{ status.lastRun.tooOld }} too old</span>
        <button v-if="status.lastRun.errors.length" id="offload-failed" type="button" class="badge bad badge-button" :aria-expanded="errorsOpen"
          title="What went wrong" @click="errorsOpen = !errorsOpen">{{ status.lastRun.errors.length }} failed {{ errorsOpen ? '▴' : '▾' }}</button>
        <span id="last-run-when" class="hint small" :title="formatTime(status.lastRun.finishedAt)">at {{ formatWhen(status.lastRun.finishedAt) }}</span>
      </div>
      <div v-if="errorsOpen && status.lastRun && !status.running && status.lastRun.errors.length" id="offload-errors" class="failures small">
        <p v-for="error in status.lastRun.errors" :key="error" class="error-text">{{ error }}</p>
        <RouterLink :to="{ path: '/debug', query: { area: 'robot', show: 'fail' } }">Every line in the Debug log</RouterLink>
      </div>
    </template>
  </section>

  <!-- The logs just downloaded, offered for clearing off the robot. -->
  <section v-if="status && (status.clearable || status.lastClear)" id="clear-robot" class="card">
    <h2>Clear the robot</h2>
    <template v-if="status.clearable && !status.running">
      <p>
        The last download pulled {{ plural(status.clearable.files.length, 'log') }} ({{ formatBytes(status.clearable.bytes) }}) from the
        robot, and they're safely on this laptop. Clear them off the robot to make room?
      </p>
      <p class="hint">
        Only these logs, and only those it's safe to: the newest log in each folder, the newest Hoot session, anything changed in
        the last 5 minutes and logs still named FRC_TBD_ stay, in case they're still being written.
      </p>
      <div class="card-actions">
        <md-outlined-button id="clear-robot-start" :disabled="status.clearing || !status.robotHost" @click="openClear">
          Clear from the robot…
        </md-outlined-button>
        <span v-if="!status.robotHost" class="hint">Connect the robot to clear them.</span>
      </div>
    </template>
    <div v-if="status.lastClear && !status.clearable" id="last-clear">
      <p>
        Cleared {{ formatTime(status.lastClear.finishedAt) }}: {{ plural(status.lastClear.deleted, 'log') }} deleted from the robot<template
          v-if="status.lastClear.foldersRemoved">, and {{ plural(status.lastClear.foldersRemoved, 'empty Hoot session folder') }}</template>.
      </p>
      <details v-if="status.lastClear.kept.length">
        <summary>{{ plural(status.lastClear.kept.length, 'log') }} left on the robot</summary>
        <ul class="clear-list">
          <li v-for="kept in status.lastClear.kept" :key="kept.name + kept.reason"><span class="path">{{ kept.name }}</span>: {{ kept.reason }}</li>
        </ul>
      </details>
      <p v-for="error in status.lastClear.errors" :key="error" class="error-text">{{ error }}</p>
    </div>
  </section>

  <ImportLogsCard @imported="reloadImported" />
  <UsbImportCard />
  <ImportedLogsCard ref="importedLogs" />

  <AppDialog :open="clearOpen" title="Delete these logs from the robot?" @close="clearOpen = false">
    <template v-if="status?.clearable">
      <p>
        {{ plural(status.clearable.files.length, 'log') }} ({{ formatBytes(status.clearable.bytes) }}) from the robot at
        {{ status.clearable.host }}, downloaded {{ formatTime(status.clearable.downloadedAt) }}:
      </p>
      <ul class="clear-list">
        <li v-for="file in status.clearable.files" :key="file.path" class="path">{{ file.path }}</li>
      </ul>
      <p class="hint small">
        Each is checked again first: one that's changed on the robot since, whose copy here isn't whole, or that may still be being
        written stays. Deleted logs can't be brought back from the robot; the copies on this laptop stay.
      </p>
      <label class="choice">
        <input id="clear-robot-sure" v-model="clearSure" type="checkbox" />
        Yes, delete these logs from the robot
      </label>
      <p v-if="clearMessage" class="error-text">{{ clearMessage }}</p>
    </template>
    <template #actions>
      <md-outlined-button @click="clearOpen = false">Cancel</md-outlined-button>
      <md-filled-button id="clear-robot-confirm" :disabled="!clearSure || status?.clearing" @click="clearNow">
        {{ status?.clearing ? 'Deleting…' : `Delete ${status?.clearable ? plural(status.clearable.files.length, 'log') : 'logs'} from the robot` }}
      </md-filled-button>
    </template>
  </AppDialog>
</template>

<style scoped>
.badge-button {
  border: none;
  font: inherit;
  cursor: pointer;
}

.failures {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 320px;
  overflow: auto;
}

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

.clear-list {
  max-height: 220px;
  overflow-y: auto;
  margin: 0;
  padding-left: 18px;
  font-size: 0.85rem;
}

.choice {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}
</style>
