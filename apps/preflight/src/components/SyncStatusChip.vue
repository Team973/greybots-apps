<script setup lang="ts">
import { computed } from 'vue';
import { useSyncStore, type SyncStatus } from '@/stores/sync-store';

const sync = useSyncStore();

const labels: Record<SyncStatus, string> = {
  offline: 'Offline',
  unlinked: 'Not linked',
  syncing: 'Syncing…',
  error: 'Sync error',
  pending: 'Pending',
  synced: 'Synced'
};

const label = computed(() => {
  const base = labels[sync.status];
  return sync.pendingCount > 0 && sync.status !== 'synced' ? `${base} · ${sync.pendingCount}` : base;
});

const tooltip = computed(() => {
  const last = sync.lastSyncAt ? `Last synced ${new Date(sync.lastSyncAt).toLocaleString()}` : 'Never synced';
  return sync.lastError ? `${sync.lastError}\n${last}` : last;
});
</script>

<template>
  <button class="sync-chip" :class="sync.status" :title="tooltip" @click="sync.syncNow()">
    <span class="dot"></span>{{ label }}
  </button>
</template>

<style scoped>
.sync-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  background: rgba(0, 0, 0, 0.2);
  color: var(--header-text-color);
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
  white-space: nowrap;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #9e9e9e;
}

.synced .dot { background: #57ab5a; }
.pending .dot, .syncing .dot { background: #e0a43a; }
.error .dot { background: #e5534b; }
.offline .dot, .unlinked .dot { background: #9e9e9e; }
</style>
