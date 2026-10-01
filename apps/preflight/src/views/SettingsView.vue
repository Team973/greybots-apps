<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import TextInput from '@greybots/common/components/TextInput.vue';
import UserManagement from '@greybots/common/components/UserManagement.vue';
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

// Accounts and their per-app roles live on the server, so the People table
// needs a connection and a server session. On a kiosk that session is the
// linked account's, so only the kiosk's admins get to act as it.
const canSeePeople = computed(() => sync.online && sync.hasServerSession && (!device.isKiosk || session.hasRole('admin')));
// Our own role may be what changed.
const onRolesChanged = () => session.refreshWebProfile().catch(() => undefined);

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

  <div v-if="canSeePeople" class="card people-card">
    <h2>People</h2>
    <p class="hint">
      Everyone with a greybots-apps account, and their role in each app. Shared with GreyScout: a change here shows up there.
      <template v-if="device.isKiosk"> Changes are made as this kiosk's linked account.</template>
    </p>
    <UserManagement @changed="onRolesChanged" />
  </div>

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
