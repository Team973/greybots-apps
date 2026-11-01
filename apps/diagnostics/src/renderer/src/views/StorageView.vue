<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import '@material/web/button/filled-button';
import '@material/web/button/outlined-button';
import NumberInput from '@greybots/common/components/Number.vue';

import type { ImportedFile, ImportStatus, ImportSummary, TeamSource } from '@shared/import';
import type { AppInfo, OffloadedFiles, OffloadedSort, StorageInfo } from '@shared/ipc';
import { describeMatch } from '@shared/offload';
import { formatBytes, formatTime } from '@/format';
import { useSettingsStore } from '@/stores/settings-store';

// What's on this computer: the data folder, logs brought in by hand, and
// everything offloaded or imported.

const store = useSettingsStore();
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
    await Promise.all([loadFiles(), loadStorage()]);
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

onMounted(async () => {
  await store.load();
  importTeam.value = store.settings.teamNumber;
  appInfo.value = await window.diagnostics.getAppInfo();
  importStatus.value = await window.diagnostics.getImportStatus();
  importResult.value = importStatus.value.last;
  await Promise.all([loadStorage(), loadFiles()]);
});

onUnmounted(() => clearInterval(importTimer));
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
        Each is filed by team, day and kind, like an offload; ones already here are skipped.
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
        Import {{ formatTime(importResult.finishedAt) }}: {{ importCounts.copied }} imported, {{ importCounts.already }} already
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

.pager {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
</style>
