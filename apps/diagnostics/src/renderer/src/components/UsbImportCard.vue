<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import Switch from '@greybots/common/components/Switch.vue';

import { usbExportFolder, type UsbStatus } from '@shared/usb';
import { formatTime, formatWhen } from '@/format';
import { useSettingsDraft } from '@/settings-draft';

// USB drives, coming in: the main process imports a drive's logs on its own
// when it's plugged in (with the switch on); this says what's plugged in
// and how the last import went, as badges. Copying out is on Log Export.

const { draft, edit } = useSettingsDraft();
const usb = ref<UsbStatus | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let unmounted = false;

async function refresh() {
  usb.value = await window.diagnostics.getUsbStatus().catch(() => usb.value);
  if (!unmounted) timer = setTimeout(refresh, 1500);
}

const autoImportHelp = computed(() => `From the drive's ${usbExportFolder} folder (logs copied from this app) and its logs folder (a roboRIO's USB stick). ` +
  `Logs already here are skipped. Logs that don't say which team's they are go under team ${draft.value.teamNumber}.`);

// The files that didn't come in, opened from the failed badge.
const failuresOpen = ref(false);
const failureName = (path: string) => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1) || path;

onMounted(refresh);
onUnmounted(() => {
  unmounted = true;
  clearTimeout(timer);
});
</script>

<template>
  <section id="usb-import-section" class="card">
    <div class="card-head">
      <h2>Transfer from USB Drive</h2>
      <span id="usb-drives" class="badge" :class="usb?.drives.length ? 'ok' : 'idle'">
        {{ usb?.drives.length ? usb.drives.map((d) => d.label).join(', ') : 'No drive plugged in' }}
      </span>
    </div>
    <div class="field-row">
      <span :title="autoImportHelp">Import from a USB drive when it's plugged in</span>
      <Switch id="usb-auto-import-switch" :model-value="draft.usbAutoImport" @update:model-value="edit({ usbAutoImport: $event })"></Switch>
    </div>
    <div v-if="usb?.autoImport" id="usb-auto-import" class="badges" :title="`${formatTime(usb.autoImport.at)}: ${usb.autoImport.message}`">
      <span class="hint small">Drive {{ usb.autoImport.drive }}</span>
      <span v-if="usb.autoImport.state === 'importing'" class="badge busy">Importing…</span>
      <span v-else-if="usb.autoImport.state === 'interrupted'" class="badge bad">Interrupted</span>
      <span v-else-if="usb.autoImport.state === 'error'" class="badge bad">Couldn't import</span>
      <template v-if="usb.autoImport.counts">
        <span class="badge ok">{{ usb.autoImport.counts.loaded }} loaded</span>
        <span class="badge warn" title="On this computer already: not copied again">{{ usb.autoImport.counts.skipped }} already here</span>
        <button v-if="usb.autoImport.counts.failed" id="usb-failed" type="button" class="badge bad badge-button" :aria-expanded="failuresOpen"
          title="Which files, and why" @click="failuresOpen = !failuresOpen">{{ usb.autoImport.counts.failed }} failed {{ failuresOpen ? '▴' : '▾' }}</button>
      </template>
      <span id="usb-import-when" class="hint small" :title="formatTime(usb.autoImport.at)">{{ usb.autoImport.state === 'importing' ? 'since' : 'at' }} {{ formatWhen(usb.autoImport.at) }}</span>
    </div>
    <div v-if="failuresOpen && usb?.autoImport?.counts?.failed" id="usb-failures" class="failures small">
      <p v-if="!usb.autoImport.failures?.length" class="hint">The reasons weren't kept for this import: see the Debug page for the next one.</p>
      <table v-else class="plain">
        <tbody>
          <tr v-for="(failure, i) in usb.autoImport.failures" :key="i">
            <td class="path" :title="failure.path">{{ failure.path ? failureName(failure.path) : '—' }}</td>
            <td class="error-text">{{ failure.message }}</td>
          </tr>
        </tbody>
      </table>
      <RouterLink :to="{ path: '/debug', query: { area: 'usb-import', show: 'fail' } }">Every line in the Debug log</RouterLink>
    </div>
  </section>
</template>

<style scoped>
.field-row {
  align-items: center;
}

.badge-button {
  border: none;
  font: inherit;
  cursor: pointer;
}

.failures {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 320px;
  overflow: auto;
}

.failures .path {
  overflow-wrap: anywhere;
}
</style>
