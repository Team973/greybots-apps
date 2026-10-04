<script setup lang="ts">
import { computed } from 'vue';
import UserManagement from '@greybots/common/components/UserManagement.vue';
import { useDeviceStore } from '@/stores/device-store';
import { useSessionStore } from '@/stores/session-store';
import { useSyncStore } from '@/stores/sync-store';

// User management: the same page in every greybots app. The sections and
// everything in them come from the shared component; this gives it the full
// width of the page.
//
// Accounts and their per-app roles live on the server, so it needs a
// connection and a server session. On a kiosk that session is the linked
// account's, so only the kiosk's admins get to act as it (kiosk crew, the
// local PIN users, are managed under Settings → Crew).
const device = useDeviceStore();
const session = useSessionStore();
const sync = useSyncStore();

const allowed = computed(() => !device.isKiosk || session.hasRole('admin'));
const unavailable = computed(() => {
  if (!allowed.value) return "Only this kiosk's admins can manage people.";
  if (!sync.online) return "You're offline. People are managed on the server, so this needs internet.";
  if (!sync.hasServerSession) return 'Link a server account (Settings → Sync) to manage people.';
  return null;
});
// Our own role may be what changed.
const onChanged = () => session.refreshWebProfile().catch(() => undefined);
</script>

<template>
  <div class="people-view">
    <header class="page-header">
      <h1>People</h1>
      <p class="hint">
        Everyone with a greybots-apps account, and their role in each app. Shared with GreyScout: a change here shows up there.
        <template v-if="device.isKiosk && !unavailable"> Changes are made as this kiosk's linked account.</template>
      </p>
    </header>
    <p v-if="unavailable" class="hint">{{ unavailable }}</p>
    <UserManagement v-else @changed="onChanged" />
  </div>
</template>

<style scoped>
.people-view {
  width: 100%;
}

.page-header h1 {
  margin: 0;
  font-size: 1.5rem;
}

.hint {
  margin: 4px 0 12px;
  opacity: 0.7;
}
</style>
