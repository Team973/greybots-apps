<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import Switch from '@greybots/common/components/Switch.vue';

import { usbExportFolder, type UsbStatus } from '@shared/usb';
import { formatTime } from '@/format';
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

onMounted(refresh);
onUnmounted(() => {
  unmounted = true;
  clearTimeout(timer);
});
</script>

<template>
  <section id="usb-import-section" class="card">
    <div class="card-head">
      <h2>USB drives</h2>
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
        <span class="badge warn">{{ usb.autoImport.counts.skipped }} skipped</span>
        <span v-if="usb.autoImport.counts.failed" class="badge bad">{{ usb.autoImport.counts.failed }} failed</span>
      </template>
    </div>
  </section>
</template>

<style scoped>
.field-row {
  align-items: center;
}
</style>
