<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import '@material/web/button/outlined-button';
import NumberInput from '@greybots/common/components/Number.vue';

import type { ImportedFile, ImportStatus, ImportSummary, TeamSource } from '@shared/import';
import { formatBytes, formatTime } from '@/format';
import { useSettingsStore } from '@/stores/settings-store';

// Logs brought in by hand: dropped on the page, or picked. Each is filed by
// team, day and kind, like a download. On the Log Import page.

const emit = defineEmits<{
  // An import finished: what's here has changed.
  imported: [];
}>();

const store = useSettingsStore();
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
    importTimer = undefined;
    importStatus.value = await window.diagnostics.getImportStatus();
    emit('imported');
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

// An import from a USB drive, while the page is open, finishes here too:
// its list shows (the USB card says how it went).
let statusTimer: ReturnType<typeof setTimeout> | undefined;
let unmounted = false;
async function watchImports() {
  const was = importStatus.value?.running ?? false;
  importStatus.value = await window.diagnostics.getImportStatus().catch(() => importStatus.value);
  if (was && importStatus.value && !importStatus.value.running && !importTimer) {
    importResult.value = importStatus.value.last;
    emit('imported');
  }
  if (!unmounted) statusTimer = setTimeout(watchImports, 1500);
}

onMounted(async () => {
  await store.load();
  importTeam.value = store.settings.teamNumber;
  importStatus.value = await window.diagnostics.getImportStatus();
  importResult.value = importStatus.value.last;
  statusTimer = setTimeout(watchImports, 1500);
});

onUnmounted(() => {
  unmounted = true;
  clearInterval(importTimer);
  clearTimeout(statusTimer);
});
</script>

<template>
  <section id="import-section" class="card">
    <h2>Import logs</h2>
    <div class="drop-zone" :class="{ over: dropping }" @dragover.prevent="dropping = true" @dragleave="dropping = false"
      @drop.prevent="onDrop">
      <strong>Drop logs here</strong>
      <span class="hint">Data logs, Hoot logs, Driver Station logs, folders of them, or zip files. Ones already here are skipped.</span>
      <div class="card-actions">
        <md-outlined-button id="import-files" :disabled="importStatus?.running" @click="choose(false)">Choose files…</md-outlined-button>
        <md-outlined-button id="import-folders" :disabled="importStatus?.running" @click="choose(true)">Choose a folder…</md-outlined-button>
      </div>
    </div>
    <div class="field-row">
      <span title="The team is found from the log's path (frc973), the robot's addresses in the log, or a Hoot log's CANivore when it can be. Otherwise this team is used, and the list says so.">
        Team, for logs that don't say
      </span>
      <NumberInput id="import-team" :model-value="importTeam" label="Team" @update:model-value="importTeam = $event"></NumberInput>
    </div>

    <div v-if="importStatus?.running && importStatus.progress" id="import-progress" class="progress">
      <div class="badges">
        <span class="badge busy">Importing {{ importStatus.progress.filesDone }}/{{ importStatus.progress.filesTotal }}</span>
        <span class="hint small">{{ formatBytes(importStatus.progress.bytesDone) }} of {{ formatBytes(importStatus.progress.bytesTotal) }}</span>
      </div>
      <progress :value="importStatus.progress.bytesDone" :max="Math.max(importStatus.progress.bytesTotal, 1)"></progress>
    </div>
    <p v-if="importMessage" class="error-text">{{ importMessage }}</p>

    <template v-if="importResult && !importStatus?.running">
      <div id="import-summary" class="badges" :title="`Imported ${formatTime(importResult.finishedAt)}${importResult.source ? ` from ${importResult.source}` : ''}`">
        <span class="badge ok">{{ importCounts.copied }} imported</span>
        <span class="badge warn">{{ importCounts.already }} already here</span>
        <span v-if="importCounts.failed" class="badge bad">{{ importCounts.failed }} failed</span>
        <span v-if="importCounts.assumed" class="badge warn" title="They didn't say which team's they are, so they were filed under the team given.">
          {{ importCounts.assumed }} team assumed
        </span>
      </div>
      <p v-for="problem in importResult.problems" :key="problem" class="error-text">{{ problem }}</p>
      <details v-if="importResult.files.length" class="import-list">
        <summary>Files</summary>
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
      </details>
    </template>
  </section>
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

.field-row {
  align-items: center;
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
</style>
