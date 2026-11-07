<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import '@material/web/button/filled-button';
import '@material/web/button/outlined-button';
import NumberInput from '@greybots/common/components/Number.vue';
import Switch from '@greybots/common/components/Switch.vue';

import type { ImportedFile, ImportStatus, ImportSummary, TeamSource } from '@shared/import';
import type { AppInfo, OffloadedFiles, OffloadedSort, SignalLogFile, StorageInfo } from '@shared/ipc';
import { eventsIn } from '@shared/log-filter';
import { describeMatch } from '@shared/offload';
import {
  defaultUsbExportFilter,
  logsToExport,
  runKinds,
  usbExportFolder,
  type RunKind,
  type UsbExportFilter,
  type UsbExportSummary,
  type UsbStatus
} from '@shared/usb';
import { formatBytes, formatTime } from '@/format';
import { useSettingsDraft } from '@/settings-draft';
import { useSettingsStore } from '@/stores/settings-store';

// What's on this computer: the data folder, logs brought in by hand or from
// a USB drive, copying logs to a USB drive, and everything offloaded or
// imported.

const store = useSettingsStore();
const { draft, edit } = useSettingsDraft();
const appInfo = ref<AppInfo | null>(null);
const storage = ref<StorageInfo | null>(null);
const storageMessage = ref('');

async function openFolder() {
  storageMessage.value = await window.diagnostics.openDataDirectory();
}

const sourceNames: Record<string, string> = {
  roborio: 'roboRIO',
  'driver-station': 'Driver Station',
  'ctre-hoot': 'CTRE Hoot'
};

const fileName = (localPath: string) => localPath.slice(localPath.lastIndexOf('/') + 1);

// --- Importing ---

const importTeam = ref(973);
const importStatus = ref<ImportStatus | null>(null);
const importResult = ref<ImportSummary | null>(null);
const importMessage = ref('');
const dropping = ref(false);
let importTimer: ReturnType<typeof setInterval> | undefined;

async function importPaths(paths: string[]) {
  if (paths.length === 0) return;
  importMessage.value = '';
  clearInterval(importTimer);
  importTimer = setInterval(async () => {
    importStatus.value = await window.diagnostics.getImportStatus();
  }, 300);
  try {
    const result = await window.diagnostics.importLogs(paths, importTeam.value);
    if (typeof result === 'string') importMessage.value = result;
    else importResult.value = result;
  } finally {
    clearInterval(importTimer);
    importStatus.value = await window.diagnostics.getImportStatus();
    await Promise.all([loadFiles(), loadStorage(), loadLogs()]);
  }
}

async function choose(folders: boolean) {
  await importPaths(await window.diagnostics.chooseImport(folders));
}

function onDrop(event: DragEvent) {
  dropping.value = false;
  const files = [...(event.dataTransfer?.files ?? [])];
  importPaths(files.map((file) => window.droppedFiles.pathFor(file)).filter((path) => path !== ''));
}

const teamNotes: Record<TeamSource, string> = {
  path: 'from its path',
  log: 'from the log',
  canivore: 'by its CANivore',
  'hoot-partner': 'by the Hoot log it started with',
  assumed: 'assumed'
};

const outcomeNames: Record<ImportedFile['outcome'], string> = {
  copied: 'Imported',
  'already-here': 'Already here',
  conflict: 'Not imported',
  error: 'Not imported'
};

const importCounts = computed(() => {
  const files = importResult.value?.files ?? [];
  return {
    copied: files.filter((f) => f.outcome === 'copied').length,
    already: files.filter((f) => f.outcome === 'already-here').length,
    failed: files.filter((f) => f.outcome === 'conflict' || f.outcome === 'error').length,
    assumed: files.filter((f) => f.teamFrom === 'assumed' && f.outcome !== 'error').length
  };
});

// --- Everything here, a page at a time ---

const pageSize = 10;
const page = ref(0);
const sort = ref<OffloadedSort>('changed');
const descending = ref(true);
const files = ref<OffloadedFiles | null>(null);
const pages = computed(() => Math.max(1, Math.ceil((files.value?.total ?? 0) / pageSize)));

async function loadFiles() {
  files.value = await window.diagnostics.getOffloadedFiles({ page: page.value, pageSize, sort: sort.value, descending: descending.value });
  // Fewer files than before (a file deleted): back to a page that has some.
  if (page.value > 0 && page.value >= pages.value) page.value = pages.value - 1;
}

// A column heading sorts by it; again, the other way.
function sortBy(column: OffloadedSort) {
  if (sort.value === column) descending.value = !descending.value;
  else {
    sort.value = column;
    descending.value = true;
  }
  page.value = 0;
}

function sortMark(column: OffloadedSort): string {
  return sort.value === column ? (descending.value ? ' ▾' : ' ▴') : '';
}

watch([page, sort, descending], loadFiles);

async function loadStorage() {
  storage.value = await window.diagnostics.getStorageInfo();
}

// --- USB drives ---
// The main process watches for drives and imports from them on its own;
// the page asks how that's going, and what's plugged in, this often, and
// more often while logs are being copied, so the progress moves smoothly.

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

async function loadLogs() {
  logs.value = await window.diagnostics.getSignalLogs();
}

async function refreshUsb() {
  const wasImporting = importStatus.value?.running ?? false;
  [usb.value, importStatus.value] = await Promise.all([window.diagnostics.getUsbStatus(), window.diagnostics.getImportStatus()]);
  measureCopySpeed();
  // An import (from a drive, most likely) just finished: what it brought in.
  if (wasImporting && !importStatus.value.running) {
    importResult.value = importStatus.value.last;
    await Promise.all([loadFiles(), loadStorage(), loadLogs()]);
  }
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
  await refreshUsb();
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

onMounted(async () => {
  await store.load();
  importTeam.value = store.settings.teamNumber;
  appInfo.value = await window.diagnostics.getAppInfo();
  importStatus.value = await window.diagnostics.getImportStatus();
  importResult.value = importStatus.value.last;
  await Promise.all([loadStorage(), loadFiles(), loadLogs(), refreshUsb()]);
  exportResult.value = usb.value?.lastExport ?? null;
  scheduleUsb();
});

onUnmounted(() => {
  clearInterval(importTimer);
  unmounted = true;
  clearTimeout(usbTimer);
});
</script>

<template>
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
        <md-outlined-button @click="openFolder">Open folder</md-outlined-button>
        <span v-if="storageMessage" class="error-text">{{ storageMessage }}</span>
      </div>
    </template>
  </section>

  <section id="import-section" class="card">
    <h2>Import logs</h2>
    <div class="drop-zone" :class="{ over: dropping }" @dragover.prevent="dropping = true" @dragleave="dropping = false"
      @drop.prevent="onDrop">
      <strong>Drop logs here</strong>
      <span class="hint">
        Data logs (.wpilog), Hoot logs (.hoot), Driver Station logs (.dslog, .dsevents), folders of them, or zip files.
        Each is filed by team, day and kind, like a download; ones already here are skipped.
      </span>
      <div class="card-actions">
        <md-outlined-button id="import-files" :disabled="importStatus?.running" @click="choose(false)">Choose files…</md-outlined-button>
        <md-outlined-button id="import-folders" :disabled="importStatus?.running" @click="choose(true)">Choose a folder…</md-outlined-button>
      </div>
    </div>
    <div class="field-row">
      <div>
        Team, for logs that don't say
        <p class="hint">
          The team is found from the log's path (frc973), the robot's addresses in the log, or a Hoot log's CANivore when
          it can be. Otherwise this team is used, and the list below says so.
        </p>
      </div>
      <NumberInput id="import-team" :model-value="importTeam" label="Team" @update:model-value="importTeam = $event"></NumberInput>
    </div>

    <div v-if="importStatus?.running && importStatus.progress" id="import-progress" class="progress">
      <span>
        Importing {{ importStatus.progress.filesDone }} of {{ importStatus.progress.filesTotal }} files
        ({{ formatBytes(importStatus.progress.bytesDone) }} of {{ formatBytes(importStatus.progress.bytesTotal) }})
      </span>
      <progress :value="importStatus.progress.bytesDone" :max="Math.max(importStatus.progress.bytesTotal, 1)"></progress>
      <span class="hint path">{{ importStatus.progress.current }}</span>
    </div>
    <p v-if="importMessage" class="error-text">{{ importMessage }}</p>

    <template v-if="importResult && !importStatus?.running">
      <p id="import-summary">
        Import<template v-if="importResult.source"> from {{ importResult.source }}</template> {{ formatTime(importResult.finishedAt) }}: {{ importCounts.copied }} imported, {{ importCounts.already }} already
        here<template v-if="importCounts.failed">, {{ importCounts.failed }} not imported</template>.
        <span v-if="importCounts.assumed" class="warning-inline">
          {{ importCounts.assumed }} didn't say which team's {{ importCounts.assumed === 1 ? 'it is' : 'they are' }}, so
          {{ importCounts.assumed === 1 ? 'it was' : 'they were' }} filed under the team given.
        </span>
      </p>
      <p v-for="problem in importResult.problems" :key="problem" class="error-text">{{ problem }}</p>
      <div v-if="importResult.files.length" class="import-list">
        <table class="plain" id="import-files-list">
          <thead>
            <tr>
              <th>File</th>
              <th>Team</th>
              <th>Filed under</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="file in importResult.files" :key="file.from">
              <td class="path" :title="file.from">{{ file.name }}</td>
              <td>{{ file.team }} <span class="hint">({{ teamNotes[file.teamFrom] }})</span></td>
              <td class="path" :title="file.localPath ?? ''">{{ file.localPath?.split('/').slice(1, -1).join('/') }}</td>
              <td :class="{ 'error-text': file.outcome === 'conflict' || file.outcome === 'error' }" :title="file.message">
                {{ outcomeNames[file.outcome] }}<template v-if="file.message">: {{ file.message }}</template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>

  <section id="usb-section" class="card">
    <h2>USB drives</h2>
    <p id="usb-drives" class="hint">
      Plugged in: {{ usb?.drives.length ? usb.drives.map((d) => d.label).join(', ') : 'no USB drives' }}.
    </p>

    <div class="field-row">
      <div>
        Import logs from a USB drive when it's plugged in
        <p class="hint">
          From the drive's <span class="path">{{ usbExportFolder }}</span> folder (logs copied from this app) and its
          <span class="path">logs</span> folder (a roboRIO's USB stick). Logs already here, however they got here, are
          skipped, so only new ones are brought in. Logs that don't say which team's they are go under team
          {{ draft.teamNumber }}.
        </p>
      </div>
      <Switch id="usb-auto-import-switch" :model-value="draft.usbAutoImport"
        @update:model-value="edit({ usbAutoImport: $event })"></Switch>
    </div>
    <p v-if="usb?.autoImport" id="usb-auto-import" :class="usb.autoImport.state === 'error' ? 'error-text' : 'hint'">
      USB drive {{ usb.autoImport.drive }}, {{ formatTime(usb.autoImport.at) }}: {{ usb.autoImport.message }}
      <template v-if="usb.autoImport.state === 'done'">The list is under Import logs above.</template>
    </p>

    <h3>Copy logs to a drive</h3>
    <p class="hint">
      Into a <span class="path">{{ usbExportFolder }}</span> folder on it, filed as they are here. Plugged into another
      computer running this app, they're imported on their own. Logs already on the drive are skipped.
    </p>
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
      <div class="field">
        Recorded in the last
        <NumberInput id="usb-days" :model-value="exportFilter.days" label="Days"
          @update:model-value="exportFilter = { ...exportFilter, days: Math.max(0, Math.trunc(Number($event) || 0)) }"></NumberInput>
        <span class="hint">0 for any age.</span>
      </div>
    </div>
    <p id="usb-export-count">
      {{ plural(chosen.length, 'log') }}<template v-if="chosen.length">, about {{ formatBytes(chosenBytes) }}</template>
      <span class="hint">(each with its Hoot and Driver Station logs)</span>
    </p>

    <div class="card-actions">
      <select id="usb-destination" v-model="destination" aria-label="Copy to">
        <option v-if="destinations.length === 0" value="" disabled>No USB drive plugged in</option>
        <option v-for="d in destinations" :key="d.value" :value="d.value">{{ d.label }}</option>
      </select>
      <md-outlined-button id="usb-choose-folder" :disabled="usb?.exporting" @click="pickFolder">Choose a folder…</md-outlined-button>
      <md-filled-button id="usb-copy" :disabled="usb?.exporting || chosen.length === 0 || !destination" @click="copyToUsb">
        {{ usb?.exporting ? 'Copying…' : `Copy ${plural(chosen.length, 'log')}` }}
      </md-filled-button>
    </div>

    <div v-if="usb?.exporting && usb.progress" id="usb-progress" class="progress">
      <span>
        Copying {{ usb.progress.filesDone }} of {{ usb.progress.filesTotal }} files
        ({{ formatBytes(usb.progress.bytesDone) }} of {{ formatBytes(usb.progress.bytesTotal) }})<template
          v-if="copySpeed">, {{ formatBytes(copySpeed) }}/s, {{ copyTimeLeft }}</template><template
          v-else>, measuring speed…</template>
      </span>
      <progress :value="usb.progress.bytesDone" :max="Math.max(usb.progress.bytesTotal, 1)"></progress>
      <span class="hint path">{{ usb.progress.current }}</span>
      <div class="card-actions">
        <md-outlined-button id="usb-cancel" :disabled="cancelling" @click="cancelCopy">
          {{ cancelling ? 'Cancelling…' : 'Cancel' }}
        </md-outlined-button>
      </div>
    </div>
    <p v-if="exportMessage" class="error-text">{{ exportMessage }}</p>
    <template v-if="exportResult && !usb?.exporting">
      <p v-if="exportResult.cancelled" id="usb-export-cancelled" class="hint">
        Cancelled. The files copied before then are on the drive; copying again carries on from there.
      </p>
      <p id="usb-export-summary">
        {{ exportResult.cancelled ? 'Stopped' : 'Copied' }} {{ formatTime(exportResult.finishedAt) }} to <span class="path">{{ exportResult.destination }}</span>:
        {{ plural(exportResult.copied, 'file') }} ({{ formatBytes(exportResult.bytes) }}), {{ exportResult.skipped }} already there<template
          v-if="exportResult.failed.length">, {{ exportResult.failed.length }} not copied</template>.
      </p>
      <p v-if="exportResult.problem" class="error-text">{{ exportResult.problem }}</p>
      <p v-for="failure in exportResult.failed" :key="failure.path" class="error-text small">
        <span class="path">{{ failure.path }}</span>: {{ failure.message }}
      </p>
    </template>
  </section>

  <section class="card">
    <h2>Logs here</h2>
    <template v-if="files">
      <p v-if="files.total === 0" class="hint">Nothing offloaded or imported yet.</p>
      <template v-else>
        <table class="plain" id="offloaded-files">
          <thead>
            <tr>
              <th>File</th>
              <th>From</th>
              <th>
                <button id="sort-match" class="sort" :aria-pressed="sort === 'match'" @click="sortBy('match')">Match{{ sortMark('match') }}</button>
              </th>
              <th>
                <button id="sort-changed" class="sort" :aria-pressed="sort === 'changed'" @click="sortBy('changed')">Last changed{{ sortMark('changed') }}</button>
              </th>
              <th class="number">Size</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="file in files.files" :key="file.localPath">
              <td class="path" :title="file.localPath">{{ fileName(file.localPath) }}</td>
              <td>
                {{ sourceNames[file.source] ?? file.source }}<span v-if="file.origin === 'import'" class="hint">, imported</span>
              </td>
              <td>{{ file.match ? describeMatch(file.match) : '' }}</td>
              <td>{{ formatTime(file.modified) }}</td>
              <td class="number">{{ formatBytes(file.size) }}</td>
            </tr>
          </tbody>
        </table>
        <div id="pager" class="pager">
          <md-outlined-button :disabled="page === 0" @click="page = 0">First</md-outlined-button>
          <md-outlined-button :disabled="page === 0" @click="page -= 1">Previous</md-outlined-button>
          <span>
            Page {{ page + 1 }} of {{ pages }}
            <span class="hint">({{ page * pageSize + 1 }}–{{ Math.min((page + 1) * pageSize, files.total) }} of {{ files.total }})</span>
          </span>
          <md-outlined-button :disabled="page >= pages - 1" @click="page += 1">Next</md-outlined-button>
          <md-outlined-button :disabled="page >= pages - 1" @click="page = pages - 1">Last</md-outlined-button>
        </div>
      </template>
    </template>
  </section>

  <p v-if="appInfo" class="hint">Version {{ appInfo.version }}</p>
</template>

<style scoped>
.drop-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 20px;
  border: 2px dashed rgba(127, 127, 127, 0.6);
  border-radius: 10px;
  text-align: center;
}

.drop-zone.over {
  border-color: #2a78d6;
  background: color-mix(in srgb, #2a78d6 12%, transparent);
}

.progress {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

progress {
  width: 100%;
}

.import-list {
  max-height: 320px;
  overflow-y: auto;
}

.warning-inline {
  display: block;
  margin-top: 4px;
  padding: 6px 8px;
  border-left: 3px solid #fab219;
  background: rgba(250, 178, 25, 0.12);
  font-size: 0.9rem;
}

.sort {
  padding: 0;
  white-space: nowrap;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: inherit;
  cursor: pointer;
}

.sort[aria-pressed='true'] {
  text-decoration: underline;
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
