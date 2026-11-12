<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import '@material/web/button/outlined-button';

import { filterIoLog, ioAreaLabels, type IoArea, type IoLogEntry, type IoOutcome } from '@shared/io-log';
import { formatBytes } from '@/format';

// The transfer log (shared/io-log.ts): every file operation while logs come
// in or go out, newest first, as it happens. Other pages link here with a
// filter set (?area=usb-import&show=fail) from their "failed" badges.

const route = useRoute();
const router = useRouter();

const entries = ref<IoLogEntry[]>([]);
const latest = ref(0);
const file = ref('');
const live = ref(true);
// Kept here: the main process keeps more, but a page this long is plenty.
const keepShown = 5000;
let timer: ReturnType<typeof setTimeout> | undefined;
let unmounted = false;

async function poll() {
  try {
    if (live.value) {
      const page = await window.diagnostics.getIoLog(latest.value);
      file.value = page.file;
      // The app restarted under the page (seq began again): all of it.
      if (page.latest < latest.value) {
        entries.value = [];
        latest.value = 0;
      } else if (page.entries.length) {
        entries.value = [...entries.value, ...page.entries].slice(-keepShown);
        latest.value = page.latest;
      }
    }
  } finally {
    if (!unmounted) timer = setTimeout(poll, 1000);
  }
}

// --- Filtering, kept in the address so a link can set it ---

type Show = 'all' | 'problems' | 'fail';
const area = computed<IoArea | null>({
  get: () => (typeof route.query.area === 'string' && route.query.area in ioAreaLabels ? route.query.area as IoArea : null),
  set: (value) => router.replace({ query: { ...route.query, area: value ?? undefined } })
});
const show = computed<Show>({
  get: () => (route.query.show === 'problems' || route.query.show === 'fail' ? route.query.show : 'all'),
  set: (value) => router.replace({ query: { ...route.query, show: value === 'all' ? undefined : value } })
});
const text = ref(typeof route.query.q === 'string' ? route.query.q : '');
watch(text, (value) => router.replace({ query: { ...route.query, q: value || undefined } }));

const outcomesFor: Record<Show, IoOutcome[] | null> = { all: null, problems: ['fail', 'skip'], fail: ['fail'] };
const shown = computed(() => filterIoLog(entries.value, { area: area.value, outcomes: outcomesFor[show.value], text: text.value }).reverse());
const counts = computed(() => {
  const inArea = area.value ? entries.value.filter((e) => e.area === area.value) : entries.value;
  return {
    ok: inArea.filter((e) => e.outcome === 'ok').length,
    skip: inArea.filter((e) => e.outcome === 'skip').length,
    fail: inArea.filter((e) => e.outcome === 'fail').length
  };
});
// A long log is drawn a part at a time.
const rowsShown = ref(300);
watch([area, show, text], () => (rowsShown.value = 300));

const outcomeLabels: Record<IoOutcome, string> = { ok: 'Done', skip: 'Skipped', fail: 'Failed' };
const outcomeBadges: Record<IoOutcome, string> = { ok: 'ok', skip: 'warn', fail: 'bad' };
const clock = (iso: string) => {
  const at = new Date(iso);
  return `${at.toLocaleTimeString(undefined, { hour12: false })}.${String(at.getMilliseconds()).padStart(3, '0')}`;
};
const duration = (ms?: number) => (ms === undefined ? '' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

const showLogFile = () => window.diagnostics.showIoLog();

onMounted(poll);
onUnmounted(() => {
  unmounted = true;
  clearTimeout(timer);
});
</script>

<template>
  <section class="card debug">
    <div class="card-head">
      <h2 title="Every file operation while logs come in or go out, since the app opened. Also written to a file, to tail.">Transfer log</h2>
      <span class="badge ok">{{ counts.ok }} done</span>
      <span class="badge warn">{{ counts.skip }} skipped</span>
      <span class="badge" :class="counts.fail ? 'bad' : 'idle'">{{ counts.fail }} failed</span>
    </div>

    <div class="filters" role="group" aria-label="Which lines">
      <label class="field">
        From
        <select id="debug-area" :value="area ?? ''" @change="area = (($event.target as HTMLSelectElement).value || null) as IoArea | null">
          <option value="">Everything</option>
          <option v-for="(label, key) in ioAreaLabels" :key="key" :value="key">{{ label }}</option>
        </select>
      </label>
      <label class="field">
        Show
        <select id="debug-show" v-model="show">
          <option value="all">Every line</option>
          <option value="problems">Skipped and failed</option>
          <option value="fail">Failed</option>
        </select>
      </label>
      <label class="field grow">
        Search
        <input id="debug-search" v-model="text" type="search" placeholder="File, operation or message" />
      </label>
      <label class="check" title="Off: the list holds still to read.">
        <input id="debug-live" v-model="live" type="checkbox" /> Live
      </label>
      <md-outlined-button id="debug-file" :title="file" @click="showLogFile">Show log file</md-outlined-button>
    </div>

    <p v-if="entries.length === 0" class="hint">Nothing yet: lines appear here as logs are downloaded, imported, copied or zipped.</p>
    <p v-else-if="shown.length === 0" class="hint">No lines match.</p>
    <table v-else id="debug-lines" class="plain lines">
      <thead>
        <tr>
          <th>Time</th>
          <th>From</th>
          <th>What</th>
          <th>Result</th>
          <th>File</th>
          <th class="number">Size</th>
          <th class="number">Took</th>
          <th>Detail</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="entry in shown.slice(0, rowsShown)" :key="entry.seq" :class="entry.outcome">
          <td class="time" :title="entry.at">{{ clock(entry.at) }}</td>
          <td>{{ ioAreaLabels[entry.area] }}</td>
          <td>{{ entry.op }}</td>
          <td><span class="badge" :class="outcomeBadges[entry.outcome]">{{ outcomeLabels[entry.outcome] }}</span></td>
          <td class="path" :title="entry.path">{{ entry.path }}</td>
          <td class="number">{{ entry.bytes === undefined ? '' : formatBytes(entry.bytes) }}</td>
          <td class="number">{{ duration(entry.ms) }}</td>
          <td class="detail">{{ entry.message }}</td>
        </tr>
      </tbody>
    </table>
    <div v-if="shown.length > rowsShown" class="card-actions">
      <md-outlined-button @click="rowsShown += 500">Show more ({{ shown.length - rowsShown }} older)</md-outlined-button>
    </div>
  </section>
</template>

<style scoped>
.debug {
  max-width: none;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field.grow {
  flex: 1;
  min-width: 200px;
}

.check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 6px;
}

select,
input[type='search'] {
  padding: 6px 8px;
  border-radius: 6px;
  font: inherit;
  color: inherit;
  background: var(--tile-background-color);
  border: 1px solid rgba(127, 127, 127, 0.6);
}

.lines {
  font-size: 0.82rem;
}

.lines td {
  vertical-align: top;
}

.lines .time {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.lines .path {
  max-width: 360px;
  overflow-wrap: anywhere;
}

.lines .detail {
  overflow-wrap: anywhere;
}

.lines tr.fail td {
  background: rgba(214, 69, 65, 0.08);
}
</style>
