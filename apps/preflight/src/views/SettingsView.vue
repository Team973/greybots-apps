<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import TextInput from '@greybots/common/components/TextInput.vue';
import '@material/web/button/filled-button';
import '@material/web/button/outlined-button';
import CrewManager from '@/components/CrewManager.vue';
import TestingClockCard from '@/components/TestingClockCard.vue';
import SyncPanel from '@/components/SyncPanel.vue';
import { appVersion, isDesktopBuild } from '@/lib/constants';
import { isStoragePersistent } from '@/lib/db';
import { useDeviceStore } from '@/stores/device-store';
import { useSessionStore } from '@/stores/session-store';
import { useSyncStore } from '@/stores/sync-store';

const device = useDeviceStore();
const session = useSessionStore();
const sync = useSyncStore();

// On a kiosk only admins may change device settings; on a personal device
// the signed-in owner can.
const canManageDevice = computed(() => !device.isKiosk || session.hasRole('admin'));

const deviceName = ref(device.deviceName);
const idleLockMinutes = ref(String(device.config?.idleLockMinutes ?? 0));
const persistent = ref<boolean | null>(null);
onMounted(async () => (persistent.value = await isStoragePersistent()));

async function saveDevice() {
  const minutes = Math.max(0, Math.round(Number(idleLockMinutes.value) || 0));
  await device.update({ deviceName: deviceName.value.trim() || device.deviceName, idleLockMinutes: minutes });
  idleLockMinutes.value = String(minutes);
}

async function reset() {
  const unsynced = sync.pendingCount > 0 ? ` ${sync.pendingCount} unsynced change(s) will be lost.` : '';
  if (!confirm(`Erase all Preflight data on this device and start over?${unsynced}`)) return;
  await device.resetDevice();
}
</script>

<template>
  <div class="card">
    <h2>Device</h2>
    <dl class="detail-list">
      <dt>Mode</dt>
      <dd>{{ device.isKiosk ? 'Kiosk (shared device)' : 'Personal' }}</dd>
      <dt>Device ID</dt>
      <dd>{{ device.config?.deviceId }}</dd>
      <dt>App version</dt>
      <dd>{{ appVersion }}</dd>
      <dt>Persistent storage</dt>
      <dd>{{ persistent === null ? '…' : persistent ? 'Yes' : 'No — the browser may clear data if space runs low' }}</dd>
    </dl>
    <template v-if="canManageDevice">
      <div class="form-row">
        <TextInput v-model="deviceName" label="Device name" />
        <TextInput v-if="device.isKiosk" v-model="idleLockMinutes" label="Auto-lock after (minutes, 0 = never)" type="number" />
      </div>
      <div class="form-row">
        <md-filled-button @click="saveDevice">Save</md-filled-button>
      </div>
    </template>
  </div>

  <SyncPanel />

  <CrewManager v-if="device.isKiosk && session.hasRole('admin')" />

  <TestingClockCard v-if="session.hasRole('admin')" />

  <div v-if="canManageDevice" class="card">
    <h2>Reset device</h2>
    <p class="hint">Erases all Preflight data stored on this device{{ device.isKiosk ? ', including crew members' : '' }}, and {{ isDesktopBuild ? 'returns to first-time setup' : 'signs you out' }}.</p>
    <div class="form-row">
      <md-outlined-button @click="reset">Reset device</md-outlined-button>
    </div>
  </div>
</template>
