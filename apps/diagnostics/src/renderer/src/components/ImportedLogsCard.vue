<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import '@material/web/button/outlined-button';

import type { OffloadedFiles, OffloadedSort } from '@shared/ipc';
import { describeMatch } from '@shared/offload';
import { formatBytes, formatTime } from '@/format';

// The logs brought in (downloaded from the robot, or imported), newest
// first, a page at a time. On the Log Import page.

const sourceNames: Record<string, string> = {
  roborio: 'roboRIO',
  'driver-station': 'Driver Station',
  'ctre-hoot': 'CTRE Hoot'
};
const fileName = (localPath: string) => localPath.slice(localPath.lastIndexOf('/') + 1);

const pageSize = 10;
const page = ref(0);
const sort = ref<OffloadedSort>('changed');
const descending = ref(true);
const files = ref<OffloadedFiles | null>(null);
const pages = computed(() => Math.max(1, Math.ceil((files.value?.total ?? 0) / pageSize)));

async function reload() {
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
const sortMark = (column: OffloadedSort) => (sort.value === column ? (descending.value ? ' ▾' : ' ▴') : '');

watch([page, sort, descending], reload);
onMounted(reload);
defineExpose({ reload });
</script>

<template>
  <section id="imported-logs" class="card">
    <h2>Latest imported logs</h2>
    <template v-if="files">
      <p v-if="files.total === 0" class="hint">Nothing downloaded or imported yet.</p>
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
              <td>{{ sourceNames[file.source] ?? file.source }}<span v-if="file.origin === 'import'" class="hint">, imported</span></td>
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
</template>

<style scoped>
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
