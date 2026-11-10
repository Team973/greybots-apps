<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import '@material/web/button/filled-button';
import '@material/web/button/outlined-button';
import NumberInput from '@greybots/common/components/Number.vue';

import {
  defaultEventZipOptions,
  eventZipFiles,
  eventZipName,
  logsForEventZip,
  type EventZipOptions,
  type EventZipStatus,
  type EventZipSummary
} from '@shared/event-zip';
import type { SignalLogFile } from '@shared/ipc';
import { eventsIn, robotLabel, robotsIn } from '@shared/log-filter';
import { robotFolderName } from '@shared/offload';
import {
  defaultUsbExportFilter,
  logsToExport,
  runKinds,
  usbExportFolder,
  type ExportedLog,
  type RunKind,
  type UsbExportFilter,
  type UsbExportSummary,
  type UsbStatus
} from '@shared/usb';
import { formatBytes, formatTime } from '@/format';
import { useSettingsStore } from '@/stores/settings-store';

// Logs going out: copying them to a USB drive (or a folder), and what's
// been copied since the app opened. The data folder is in Settings.
// Bringing logs in (from the robot, files or a USB drive) is Log Import.

const fileName = (localPath: string) => localPath.slice(localPath.lastIndexOf('/') + 1);
// Where a file was copied to, short: the drive (E:\) or the folder holding
// the export folder.
function placeName(destination: string): string {
  const parts = destination.split(/[\\/]/).filter(Boolean);
  const holder = parts.length > 1 ? parts[parts.length - 2] : parts[0] ?? destination;
  return /^[A-Za-z]:$/.test(holder) ? `${holder}\\` : holder;
}
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

// --- USB drives ---
// What's plugged in, asked for this often, and more often while logs are
// being copied, so the progress moves smoothly.

const usbRefreshMs = 1500;
const copyingRefreshMs = 300;
const usb = ref<UsbStatus | null>(null);
const logs = ref<SignalLogFile[]>([]);
let usbTimer: ReturnType<typeof setTimeout> | undefined;
let unmounted = false;

// How fast the copy is going, in bytes a second: files done over the time
// since copying started. Only ever measured, not estimated, so it doesn't
// sink between one file finishing and the next.
const copySpeed = ref<number | null>(null);

function measureCopySpeed() {
  const progress = usb.value?.exporting ? usb.value.progress : null;
  const since = progress?.copyingSince ? Date.parse(progress.copyingSince) : NaN;
  const seconds = (Date.now() - since) / 1000;
  copySpeed.value = progress && progress.bytesCopied > 0 && seconds > 0 ? progress.bytesCopied / seconds : null;
}

// "about 2 min left", once there's a speed to go on.
const copyTimeLeft = computed(() => {
  const progress = usb.value?.progress;
  if (!progress || !copySpeed.value || copySpeed.value < 1) return '';
  const seconds = (progress.bytesTotal - progress.bytesDone) / copySpeed.value;
  if (seconds < 60) return 'less than a minute left';
  const minutes = Math.round(seconds / 60);
  return minutes < 90 ? `about ${minutes} min left` : `about ${(minutes / 60).toFixed(1)} hours left`;
});

function scheduleUsb() {
  if (unmounted) return;
  usbTimer = setTimeout(async () => {
    await refreshUsb().catch(() => {});
    scheduleUsb();
  }, usb.value?.exporting ? copyingRefreshMs : usbRefreshMs);
}

async function refreshUsb() {
  usb.value = await window.diagnostics.getUsbStatus();
  measureCopySpeed();
}

// Which logs to copy.
const exportFilter = ref<UsbExportFilter>({ ...defaultUsbExportFilter, kinds: [...defaultUsbExportFilter.kinds] });
const logEvents = computed(() => eventsIn(logs.value));
const chosen = computed(() => logsToExport(logs.value, exportFilter.value));
// A Driver Station log two logs share is counted twice, so "about".
const chosenBytes = computed(() => chosen.value.reduce((total, log) => total + log.size, 0));

function setKind(kind: RunKind, on: boolean) {
  const kinds = exportFilter.value.kinds.filter((k) => k !== kind);
  exportFilter.value = { ...exportFilter.value, kinds: on ? [...kinds, kind] : kinds };
}

// Where to: a drive plugged in, or a folder picked.
const pickedFolder = ref('');
const destination = ref('');
const destinations = computed(() => [
  ...(usb.value?.drives ?? []).map((drive) => ({ value: drive.root, label: `USB drive ${drive.label}` })),
  ...(pickedFolder.value ? [{ value: pickedFolder.value, label: pickedFolder.value }] : [])
]);
// The first drive, until one's picked; a drive taken out isn't kept.
watch(destinations, (list) => {
  if (!list.some((d) => d.value === destination.value)) destination.value = list[0]?.value ?? '';
});

async function pickFolder() {
  const folder = await window.diagnostics.chooseUsbFolder();
  if (!folder) return;
  pickedFolder.value = folder;
  destination.value = folder;
}

const exportMessage = ref('');
const exportResult = ref<UsbExportSummary | null>(null);
const cancelling = ref(false);

async function cancelCopy() {
  cancelling.value = true;
  await window.diagnostics.cancelUsbExport();
}

async function copyToUsb() {
  exportMessage.value = '';
  cancelling.value = false;
  const copying = window.diagnostics.exportToUsb(chosen.value.map((log) => log.id), destination.value);
  await refreshUsb();
  const result = await copying;
  if (typeof result === 'string') exportMessage.value = result;
  else exportResult.value = result;
  await Promise.all([refreshUsb(), loadExports()]);
}

// The explanations, on hover, so the card is mostly its status badges.
const copyHelp = `Into a ${usbExportFolder} folder on it, filed as they are here, each log with its Hoot and Driver Station logs. ` +
  "Plugged into another computer running this app, they're imported on their own. Logs already on the drive are skipped.";

// --- An event's logs in one zip ---

// The team: the default team's, as Reports and Signals are, if it has logs
// here; or every team's.
const settingsStore = useSettingsStore();
const zipRobots = computed(() => robotsIn(logs.value.filter((log) => log.match)));
const zipOptions = ref<EventZipOptions>(defaultEventZipOptions(''));
let zipRobotChosen = false;
watch([zipRobots, () => settingsStore.loaded], ([robots]) => {
  if (zipRobotChosen && (zipOptions.value.robot === null || robots.includes(zipOptions.value.robot))) return;
  const preferred = settingsStore.loaded ? robotFolderName(settingsStore.settings) : '';
  zipOptions.value = { ...zipOptions.value, robot: robots.includes(preferred) ? preferred : robots[0] ?? null };
}, { immediate: true });
const zipRobot = computed({
  get: () => zipOptions.value.robot ?? '',
  set: (robot: string) => {
    zipRobotChosen = true;
    zipOptions.value = { ...zipOptions.value, robot: robot || null };
  }
});

// The team's events, newest first (by their latest match), defaulting to
// the newest.
const zipEvents = computed(() => {
  const latest = new Map<string, number>();
  for (const log of logs.value) {
    if (zipOptions.value.robot && log.robot !== zipOptions.value.robot) continue;
    const event = log.match?.event.toUpperCase();
    const at = Date.parse(log.recorded);
    if (event) latest.set(event, Math.max(latest.get(event) ?? -Infinity, Number.isNaN(at) ? -Infinity : at));
  }
  return [...latest].sort((a, b) => b[1] - a[1]).map(([event]) => event);
});
watch(zipEvents, (events) => {
  if (!events.includes(zipOptions.value.event)) zipOptions.value = { ...zipOptions.value, event: events[0] ?? '' };
}, { immediate: true });
const zipLogs = computed(() => (zipOptions.value.event ? logsForEventZip(logs.value, zipOptions.value) : []));
const zipFiles = computed(() => eventZipFiles(zipLogs.value, zipOptions.value));
const zipBytes = computed(() => zipFiles.value.reduce((total, file) => total + file.size, 0));
const zipRunLabels: Record<RunKind, string> = {
  practice: 'Practice matches',
  qualification: 'Qualification matches',
  elimination: 'Playoff matches',
  none: "Not a match, on the event's days"
};

function setZipKind(kind: RunKind, on: boolean) {
  const kinds = zipOptions.value.kinds.filter((k) => k !== kind);
  zipOptions.value = { ...zipOptions.value, kinds: on ? [...kinds, kind] : kinds };
}

const zip = ref<EventZipStatus | null>(null);
const zipMessage = ref('');
const zipResult = ref<EventZipSummary | null>(null);
const zipCancelling = ref(false);
let zipTimer: ReturnType<typeof setInterval> | undefined;

async function refreshZip() {
  zip.value = await window.diagnostics.getEventZipStatus();
}

async function saveZip() {
  zipMessage.value = '';
  zipCancelling.value = false;
  const saving = window.diagnostics.saveEventZip({ ...zipOptions.value, kinds: [...zipOptions.value.kinds] });
  // Progress while it's written; the save dialog comes first.
  zipTimer = setInterval(() => void refreshZip().catch(() => {}), copyingRefreshMs);
  try {
    const result = await saving;
    if (typeof result === 'string') zipMessage.value = result;
    else if (result) zipResult.value = result;
  } catch (error) {
    zipMessage.value = (error as Error).message;
  } finally {
    clearInterval(zipTimer);
    await refreshZip();
  }
}

async function cancelZip() {
  zipCancelling.value = true;
  await window.diagnostics.cancelEventZip();
}

const showZip = () => window.diagnostics.showEventZip();
const zipFileName = (path: string) => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
const zipHelp = 'Each log with its Hoot and Driver Station logs, filed by team and day as they are here, so the zip imports back on the Log Import page.';

// --- Recently exported logs: since the app opened, a page at a time ---

const exported = ref<ExportedLog[]>([]);
const pageSize = 10;
const page = ref(0);
const pages = computed(() => Math.max(1, Math.ceil(exported.value.length / pageSize)));
const shownExports = computed(() => exported.value.slice(page.value * pageSize, (page.value + 1) * pageSize));

async function loadExports() {
  exported.value = await window.diagnostics.getRecentExports();
  if (page.value >= pages.value) page.value = pages.value - 1;
}

onMounted(async () => {
  if (!settingsStore.loaded) await settingsStore.load();
  logs.value = await window.diagnostics.getSignalLogs();
  await Promise.all([refreshUsb(), loadExports(), refreshZip()]);
  exportResult.value = usb.value?.lastExport ?? null;
  zipResult.value = zip.value?.last ?? null;
  scheduleUsb();
});

onUnmounted(() => {
  unmounted = true;
  clearTimeout(usbTimer);
  clearInterval(zipTimer);
});
</script>

<template>
  <section id="usb-section" class="card">
    <div class="card-head">
      <h2>USB drives</h2>
      <span id="usb-drives" class="badge" :class="usb?.drives.length ? 'ok' : 'idle'">
        {{ usb?.drives.length ? usb.drives.map((d) => d.label).join(', ') : 'No drive plugged in' }}
      </span>
    </div>

    <div class="usb-filter" role="group" aria-label="Which logs to copy">
      <label class="field">
        Event
        <select id="usb-event" v-model="exportFilter.event">
          <option :value="null">All events, and logs not from a match</option>
          <option v-for="event in logEvents" :key="event" :value="event">{{ event }}</option>
        </select>
      </label>
      <fieldset class="kinds">
        <legend>Runs</legend>
        <label v-for="run in runKinds" :key="run.kind" class="check">
          <input :id="`usb-kind-${run.kind}`" type="checkbox" :checked="exportFilter.kinds.includes(run.kind)"
            @change="setKind(run.kind, ($event.target as HTMLInputElement).checked)" />
          {{ run.label }}
        </label>
      </fieldset>
      <div class="field" title="0 for any age">
        Recorded in the last
        <NumberInput id="usb-days" :model-value="exportFilter.days" label="Days (0: any)"
          @update:model-value="exportFilter = { ...exportFilter, days: Math.max(0, Math.trunc(Number($event) || 0)) }"></NumberInput>
      </div>
    </div>

    <div class="card-actions">
      <select id="usb-destination" v-model="destination" aria-label="Copy to">
        <option v-if="destinations.length === 0" value="" disabled>No USB drive plugged in</option>
        <option v-for="d in destinations" :key="d.value" :value="d.value">{{ d.label }}</option>
      </select>
      <md-outlined-button id="usb-choose-folder" :disabled="usb?.exporting" @click="pickFolder">Choose a folder…</md-outlined-button>
      <md-filled-button id="usb-copy" :disabled="usb?.exporting || chosen.length === 0 || !destination" :title="copyHelp" @click="copyToUsb">
        {{ usb?.exporting ? 'Copying…' : `Copy ${plural(chosen.length, 'log')}` }}<template v-if="!usb?.exporting && chosen.length"> ({{ formatBytes(chosenBytes) }})</template>
      </md-filled-button>
    </div>

    <div v-if="usb?.exporting && usb.progress" id="usb-progress" class="progress">
      <div class="badges">
        <span class="badge busy">Copying {{ usb.progress.filesDone }}/{{ usb.progress.filesTotal }}</span>
        <span class="hint small" :title="usb.progress.current">{{ copySpeed ? `${formatBytes(copySpeed)}/s · ${copyTimeLeft}` : 'measuring speed…' }}</span>
        <md-outlined-button id="usb-cancel" :disabled="cancelling" @click="cancelCopy">{{ cancelling ? 'Cancelling…' : 'Cancel' }}</md-outlined-button>
      </div>
      <progress :value="usb.progress.bytesDone" :max="Math.max(usb.progress.bytesTotal, 1)"></progress>
    </div>
    <p v-if="exportMessage" class="error-text">{{ exportMessage }}</p>
    <div v-if="exportResult && !usb?.exporting" id="usb-export-summary" class="badges"
      :title="`${formatTime(exportResult.finishedAt)} to ${exportResult.destination}${exportResult.problem ? `: ${exportResult.problem}` : ''}`">
      <span v-if="exportResult.cancelled" id="usb-export-cancelled" class="badge warn">Cancelled</span>
      <span v-else-if="exportResult.problem" class="badge bad">Interrupted</span>
      <span class="badge ok">{{ exportResult.copied }} copied</span>
      <span class="badge warn">{{ exportResult.skipped }} skipped</span>
      <span v-if="exportResult.failed.length" class="badge bad">{{ exportResult.failed.length }} failed</span>
    </div>
    <details v-if="exportResult && !usb?.exporting && (exportResult.problem || exportResult.failed.length)" class="small">
      <summary>What went wrong</summary>
      <p v-if="exportResult.problem" class="error-text">{{ exportResult.problem }}</p>
      <p v-for="failure in exportResult.failed" :key="failure.path" class="error-text"><span class="path">{{ failure.path }}</span>: {{ failure.message }}</p>
    </details>
  </section>

  <section id="event-zip" class="card">
    <div class="card-head">
      <h2>Zip an event</h2>
    </div>
    <p v-if="zipEvents.length === 0" class="hint">No match logs yet: an event's logs can be zipped once there are some.</p>
    <template v-else>
      <div class="usb-filter" role="group" aria-label="Which logs to zip">
        <label class="field">
          Team
          <select id="zip-team" v-model="zipRobot">
            <option value="">All teams</option>
            <option v-for="robot in zipRobots" :key="robot" :value="robot">{{ robotLabel(robot) }}</option>
          </select>
        </label>
        <label class="field">
          Event
          <select id="zip-event" v-model="zipOptions.event">
            <option v-for="event in zipEvents" :key="event" :value="event">{{ event }}</option>
          </select>
        </label>
        <fieldset class="kinds">
          <legend>Runs</legend>
          <label v-for="run in runKinds" :key="run.kind" class="check">
            <input :id="'zip-kind-' + run.kind" type="checkbox" :checked="zipOptions.kinds.includes(run.kind)"
              @change="setZipKind(run.kind, ($event.target as HTMLInputElement).checked)" />
            {{ zipRunLabels[run.kind] }}
          </label>
        </fieldset>
        <fieldset class="kinds">
          <legend>With each log</legend>
          <label class="check"><input id="zip-hoots" v-model="zipOptions.hoots" type="checkbox" /> Hoot logs</label>
          <label class="check"><input id="zip-ds" v-model="zipOptions.driverStation" type="checkbox" /> Driver Station logs</label>
        </fieldset>
      </div>

      <div class="card-actions">
        <md-filled-button id="zip-save" :disabled="zip?.running || zipFiles.length === 0" :title="zipHelp" @click="saveZip">
          {{ zip?.running ? 'Zipping…' : 'Save zip…' }}
        </md-filled-button>
        <span id="zip-summary" class="hint small">
          {{ plural(zipLogs.length, 'log') }}, {{ plural(zipFiles.length, 'file') }}<template v-if="zipFiles.length">, {{ formatBytes(zipBytes) }} before zipping</template>
          · {{ eventZipName(zipOptions.event, zipOptions.robot) }}
        </span>
      </div>

      <div v-if="zip?.running && zip.progress" id="zip-progress" class="progress">
        <div class="badges">
          <span class="badge busy">Zipping {{ zip.progress.filesDone }}/{{ zip.progress.filesTotal }}</span>
          <span class="hint small path">{{ zip.progress.current }}</span>
          <md-outlined-button id="zip-cancel" :disabled="zipCancelling" @click="cancelZip">{{ zipCancelling ? 'Cancelling…' : 'Cancel' }}</md-outlined-button>
        </div>
        <progress :value="zip.progress.bytesDone" :max="Math.max(zip.progress.bytesTotal, 1)"></progress>
      </div>
      <p v-if="zipMessage" class="error-text">{{ zipMessage }}</p>
      <div v-if="zipResult && !zip?.running" id="zip-result" class="badges" :title="formatTime(zipResult.finishedAt) + ': ' + zipResult.path">
        <span v-if="zipResult.cancelled" class="badge warn">Cancelled</span>
        <span v-else-if="zipResult.problem" class="badge bad" :title="zipResult.problem">Failed: {{ zipResult.problem }}</span>
        <template v-else>
          <span class="badge ok">Saved {{ zipFileName(zipResult.path) }}</span>
          <span class="hint small">{{ plural(zipResult.files, 'file') }}, {{ formatBytes(zipResult.bytesOut) }}</span>
          <span v-if="zipResult.missing.length" class="badge warn" :title="zipResult.missing.join(', ')">{{ zipResult.missing.length }} missing</span>
          <md-outlined-button id="zip-show" @click="showZip">Show in folder</md-outlined-button>
        </template>
      </div>
    </template>
  </section>

  <section id="exported-logs" class="card">
    <h2>Recently exported logs</h2>
    <p v-if="exported.length === 0" class="hint">Nothing copied to a drive since the app opened.</p>
    <template v-else>
      <table class="plain" id="exported-files">
        <thead>
          <tr>
            <th>File</th>
            <th>To</th>
            <th>When</th>
            <th class="number">Size</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="file in shownExports" :key="`${file.destination}\n${file.localPath}`">
            <td class="path" :title="file.localPath">{{ fileName(file.localPath) }}</td>
            <td class="path" :title="file.destination">{{ placeName(file.destination) }}</td>
            <td>{{ formatTime(file.at) }}</td>
            <td class="number">{{ formatBytes(file.size) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="pages > 1" class="pager">
        <md-outlined-button :disabled="page === 0" @click="page -= 1">Previous</md-outlined-button>
        <span>Page {{ page + 1 }} of {{ pages }} <span class="hint">({{ exported.length }} files)</span></span>
        <md-outlined-button :disabled="page >= pages - 1" @click="page += 1">Next</md-outlined-button>
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

progress {
  width: 100%;
}

.usb-filter {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 12px 20px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.kinds {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  border: none;
}

.kinds legend {
  padding: 0;
  margin-bottom: 4px;
}

.check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

select {
  padding: 6px 8px;
  border-radius: 6px;
  font: inherit;
  color: inherit;
  background: var(--tile-background-color);
  border: 1px solid rgba(127, 127, 127, 0.6);
}

.pager {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
</style>
