<script setup lang="ts">
// @ts-nocheck
import { ref, onMounted, onUnmounted } from 'vue';
import { useOfflineQueueStore } from '@/stores/offline-queue-store';
import { upsertPersonalPicklist, upsertTeamPicklist } from '@/lib/picklist-query';
import { submitScoutData, updateScoutData } from '@/lib/data-submission';
import { saveAutoSelections } from '@/lib/strategy-query';
import { matchScoutTable, pitScoutTable, autoPathTable, strategyBoardTable } from '@/lib/constants';

const queueStore = useOfflineQueueStore();
const isOpen = ref(false);
const isOnline = ref(navigator.onLine);

function handleOnline() { isOnline.value = true; }
function handleOffline() { isOnline.value = false; }

onMounted(() => {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
});
onUnmounted(() => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
});

const retryHandlers = {
    picklist_personal: async (payload: Record<string, unknown>) => {
        return await upsertPersonalPicklist(
            payload.userId as string,
            payload.eventId as string,
            payload.archetype as 'scorer' | 'defender',
            payload.teamNumbers as number[],
            payload.teamTiers as Record<number, string>
        );
    },
    picklist_team: async (payload: Record<string, unknown>) => {
        return await upsertTeamPicklist(
            payload.eventId as string,
            payload.archetype as 'scorer' | 'defender',
            payload.teamNumbers as number[],
            payload.teamTiers as Record<number, string>
        );
    },
    scout_data: async (payload: Record<string, unknown>) => {
        if (payload.id != null) {
            return await updateScoutData(
                payload.id as number,
                payload.data as Record<string, unknown>,
                payload.table as string
            );
        }
        return await submitScoutData(
            payload.data as Record<string, unknown>,
            payload.table as string
        );
    },
    // Same shape as scout_data ({ table, data, id }) — the strategy board's
    // debounced auto-save reuses submitScoutData/updateScoutData directly.
    strategy_board: async (payload: Record<string, unknown>) => {
        if (payload.id != null) {
            return await updateScoutData(
                payload.id as number,
                payload.data as Record<string, unknown>,
                payload.table as string
            );
        }
        return await submitScoutData(
            payload.data as Record<string, unknown>,
            payload.table as string
        );
    },
    // Unlike strategy_board, this goes straight through saveAutoSelections's
    // own upsert rather than an id-tracked update/insert — the row may have
    // been created (by a board save, or another auto-selection save) between
    // when this was queued and when it's retried, and an upsert keyed on
    // (event, match_number) sidesteps needing to know which case it is.
    strategy_auto_selections: async (payload: Record<string, unknown>) => {
        return await saveAutoSelections(
            payload.eventId as string,
            payload.matchNumber as number,
            payload.autoSelections as unknown[]
        );
    }
};

async function retryAll() {
    await queueStore.retryAll(retryHandlers);
}

async function retryOne(id: string) {
    const item = queueStore.queue.find(q => q.id === id);
    if (!item) return;
    const handler = retryHandlers[item.type];
    if (handler) await queueStore.retryItem(id, handler);
}

function typeLabel(item: { type: string; payload: Record<string, unknown> }) {
    if (item.type === 'picklist_personal') return 'Personal Pick List';
    if (item.type === 'picklist_team') return 'Team Pick List';
    if (item.type === 'scout_data') {
        if (item.payload?.table === matchScoutTable) return 'Match Scouting';
        if (item.payload?.table === pitScoutTable) return 'Pit Scouting';
        if (item.payload?.table === autoPathTable) return 'Auto Path';
        return 'Scouting Data';
    }
    if (item.type === 'strategy_board') return 'Strategy Board';
    if (item.type === 'strategy_auto_selections') return 'Strategy Auto Picks';
    return item.type;
}

function formatDate(iso: string) {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
</script>

<template>
    <!-- Offline status banner -->
    <div v-if="!isOnline" class="offline-banner" role="alert">
        <span class="offline-icon">&#9888;</span>
        You are offline — changes will be saved locally and synced when you reconnect.
    </div>

    <!-- Queue indicator button -->
    <div
        v-if="queueStore.hasPending"
        class="offline-queue-fab"
        :class="{ 'offline-queue-fab--open': isOpen }"
        @click="isOpen = !isOpen"
        title="Pending offline items"
        role="button"
        aria-label="View offline queue"
    >
        <span class="offline-queue-count">{{ queueStore.pendingCount }}</span>
        <span class="offline-queue-icon">&#8646;</span>
    </div>

    <!-- Queue drawer -->
    <transition name="queue-slide">
        <div v-if="isOpen && queueStore.hasPending" class="offline-queue-drawer">
            <div class="offline-queue-header">
                <span>Pending Sync ({{ queueStore.pendingCount }})</span>
                <div class="offline-queue-header-actions">
                    <button
                        class="queue-btn queue-btn--retry"
                        :disabled="queueStore.isRetrying || !isOnline"
                        @click="retryAll"
                    >
                        {{ queueStore.isRetrying ? 'Syncing...' : 'Retry All' }}
                    </button>
                    <button class="queue-btn queue-btn--close" @click="isOpen = false">&#10005;</button>
                </div>
            </div>

            <ul class="offline-queue-list">
                <li v-for="item in queueStore.queue" :key="item.id" class="offline-queue-item">
                    <div class="queue-item-info">
                        <span class="queue-item-type">{{ typeLabel(item) }}</span>
                        <span class="queue-item-time">{{ formatDate(item.enqueuedAt) }}</span>
                    </div>
                    <div v-if="item.lastError" class="queue-item-error">{{ item.lastError }}</div>
                    <div class="queue-item-actions">
                        <button
                            class="queue-btn queue-btn--retry"
                            :disabled="queueStore.isRetrying || !isOnline"
                            @click="retryOne(item.id)"
                        >Retry</button>
                        <button class="queue-btn queue-btn--discard" @click="queueStore.removeItem(item.id)">
                            Discard
                        </button>
                    </div>
                </li>
            </ul>
        </div>
    </transition>
</template>

<style scoped>
.offline-banner {
    position: fixed;
    top: 65px;
    left: 0;
    right: 0;
    z-index: 9998;
    background: #b05703;
    color: #fff;
    text-align: center;
    padding: 8px 16px;
    font-size: 14px;
    font-weight: 500;
    letter-spacing: 0.02em;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
}

.offline-icon {
    margin-right: 8px;
}

.offline-queue-fab {
    position: fixed;
    bottom: 28px;
    right: 28px;
    z-index: 9997;
    width: 54px;
    height: 54px;
    border-radius: 50%;
    background: #b05703;
    color: #fff;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(0,0,0,0.35);
    transition: transform 0.2s ease, background 0.2s ease;
    user-select: none;
}
.offline-queue-fab:hover {
    background: #cd8900;
    transform: scale(1.08);
}
.offline-queue-count {
    font-size: 15px;
    font-weight: 700;
    line-height: 1;
}
.offline-queue-icon {
    font-size: 12px;
    line-height: 1;
}

.offline-queue-drawer {
    position: fixed;
    bottom: 92px;
    right: 28px;
    z-index: 9997;
    width: 320px;
    max-height: 420px;
    overflow-y: auto;
    background: var(--tile-background-color);
    border-radius: 14px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.35);
    padding: 0;
    display: flex;
    flex-direction: column;
}

.offline-queue-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px 10px;
    border-bottom: 1px solid rgba(128,128,128,0.2);
    font-weight: 600;
    font-size: 14px;
    color: var(--primary-text-color);
    position: sticky;
    top: 0;
    background: var(--tile-background-color);
    border-radius: 14px 14px 0 0;
}
.offline-queue-header-actions {
    display: flex;
    gap: 8px;
    align-items: center;
}

.offline-queue-list {
    list-style: none;
    padding: 8px 0;
    margin: 0;
}

.offline-queue-item {
    padding: 10px 16px;
    border-bottom: 1px solid rgba(128,128,128,0.1);
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.offline-queue-item:last-child {
    border-bottom: none;
}

.queue-item-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.queue-item-type {
    font-size: 13px;
    font-weight: 600;
    color: var(--primary-text-color);
}
.queue-item-time {
    font-size: 11px;
    color: rgba(128,128,128,0.8);
}
.queue-item-error {
    font-size: 11px;
    color: #e05050;
    font-style: italic;
}
.queue-item-actions {
    display: flex;
    gap: 8px;
}

.queue-btn {
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    font-weight: 500;
    transition: background 0.15s ease;
}
.queue-btn--retry {
    background: #b05703;
    color: #fff;
}
.queue-btn--retry:hover:not(:disabled) { background: #cd8900; }
.queue-btn--retry:disabled { opacity: 0.5; cursor: not-allowed; }
.queue-btn--discard {
    background: rgba(128,128,128,0.15);
    color: var(--primary-text-color);
}
.queue-btn--discard:hover { background: rgba(200,50,50,0.2); }
.queue-btn--close {
    background: rgba(128,128,128,0.15);
    color: var(--primary-text-color);
    width: 26px;
    height: 26px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
}

.queue-slide-enter-active,
.queue-slide-leave-active {
    transition: opacity 0.2s ease, transform 0.2s ease;
}
.queue-slide-enter-from,
.queue-slide-leave-to {
    opacity: 0;
    transform: translateY(12px);
}
</style>
