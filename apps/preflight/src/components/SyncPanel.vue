<script setup lang="ts">
import { ref } from 'vue';
import TextInput from '@greybots/common/components/TextInput.vue';
import '@material/web/button/filled-button';
import '@material/web/button/outlined-button';
import SyncStatusChip from './SyncStatusChip.vue';
import { useDeviceStore } from '@/stores/device-store';
import { useSessionStore } from '@/stores/session-store';
import { useSyncStore } from '@/stores/sync-store';

const device = useDeviceStore();
const session = useSessionStore();
const sync = useSyncStore();

const email = ref('');
const password = ref('');
const linkError = ref<string | null>(null);
const busy = ref(false);

async function link() {
  linkError.value = null;
  busy.value = true;
  try {
    await sync.linkAccount(email.value.trim(), password.value);
    email.value = '';
    password.value = '';
  } catch (e) {
    linkError.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

async function unlink() {
  if (sync.pendingCount > 0 && !confirm(`${sync.pendingCount} change(s) haven't synced yet. Unlink anyway?`)) return;
  await sync.unlinkAccount();
}
</script>

<template>
  <div class="card">
    <h2>Sync</h2>
    <dl class="detail-list">
      <dt>Status</dt>
      <dd><SyncStatusChip class="chip" /></dd>
      <dt>Unsynced changes</dt>
      <dd>{{ sync.pendingCount }}</dd>
      <dt>Last synced</dt>
      <dd>{{ sync.lastSyncAt ? new Date(sync.lastSyncAt).toLocaleString() : 'Never' }}</dd>
      <template v-if="sync.lastError">
        <dt>Last error</dt>
        <dd class="error-text">{{ sync.lastError }}</dd>
      </template>
      <template v-if="device.isKiosk">
        <dt>Linked account</dt>
        <dd>{{ sync.hasServerSession && sync.linkedAccount ? `${sync.linkedAccount.name} (${sync.linkedAccount.email})` : 'None' }}</dd>
      </template>
    </dl>
    <div class="form-row">
      <md-filled-button :disabled="sync.syncing || !sync.hasServerSession" @click="sync.syncNow()">Sync now</md-filled-button>
      <md-outlined-button v-if="device.isKiosk && sync.hasServerSession && session.hasRole('admin')" @click="unlink">
        Unlink account
      </md-outlined-button>
    </div>

    <template v-if="device.isKiosk && !sync.hasServerSession && session.hasRole('admin')">
      <p class="hint">
        Link a lead or admin greybots-apps account so this device can sync when it has internet. Crew members keep
        signing in with their PINs.
      </p>
      <div class="form-row">
        <TextInput v-model="email" label="Email" type="email" />
        <TextInput v-model="password" label="Password" type="password" />
      </div>
      <p v-if="linkError" class="error-text">{{ linkError }}</p>
      <div class="form-row">
        <md-filled-button :disabled="busy || !sync.online" @click="link">Link account</md-filled-button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.chip {
  border-color: var(--primary-text-color);
  color: var(--primary-text-color);
}
</style>
