// @ts-nocheck

import { defineStore } from 'pinia';
import { offlineQueueKey } from '@/lib/constants';

export interface QueueItem {
    id: string;
    type: 'picklist_personal' | 'picklist_team' | 'scout_data' | 'strategy_board' | 'strategy_auto_selections';
    payload: Record<string, unknown>;
    enqueuedAt: string;
    retries: number;
    lastError?: string;
}

function loadFromStorage(): QueueItem[] {
    try {
        const raw = localStorage.getItem(offlineQueueKey);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function saveToStorage(items: QueueItem[]) {
    try {
        localStorage.setItem(offlineQueueKey, JSON.stringify(items));
    } catch (e) {
        console.warn('Failed to persist offline queue:', e);
    }
}

export const useOfflineQueueStore = defineStore('offlineQueue', {
    state() {
        return {
            queue: loadFromStorage() as QueueItem[],
            isRetrying: false
        };
    },
    getters: {
        pendingCount(): number {
            return this.queue.length;
        },
        hasPending(): boolean {
            return this.queue.length > 0;
        }
    },
    actions: {
        enqueue(type: QueueItem['type'], payload: Record<string, unknown>, error?: string) {
            // Deduplicate picklist saves to avoid flooding the queue if offline and autosaving
            if (type === 'picklist_personal') {
                const existing = this.queue.find(q => q.type === type && q.payload.userId === payload.userId && q.payload.eventId === payload.eventId && q.payload.archetype === payload.archetype);
                if (existing) {
                    existing.payload = payload;
                    existing.enqueuedAt = new Date().toISOString();
                    existing.lastError = error;
                    saveToStorage(this.queue);
                    return;
                }
            } else if (type === 'picklist_team') {
                const existing = this.queue.find(q => q.type === type && q.payload.eventId === payload.eventId && q.payload.archetype === payload.archetype);
                if (existing) {
                    existing.payload = payload;
                    existing.enqueuedAt = new Date().toISOString();
                    existing.lastError = error;
                    saveToStorage(this.queue);
                    return;
                }
            } else if (type === 'strategy_board') {
                // Rapid auto-saves while drawing should collapse to one
                // pending retry item per match, same as the picklist types.
                const existing = this.queue.find(q => q.type === type && q.payload.data?.event === payload.data?.event && q.payload.data?.match_number === payload.data?.match_number);
                if (existing) {
                    existing.payload = payload;
                    existing.enqueuedAt = new Date().toISOString();
                    existing.lastError = error;
                    saveToStorage(this.queue);
                    return;
                }
            } else if (type === 'strategy_auto_selections') {
                // Same collapsing behavior, keyed the same way as strategy_board.
                const existing = this.queue.find(q => q.type === type && q.payload.eventId === payload.eventId && q.payload.matchNumber === payload.matchNumber);
                if (existing) {
                    existing.payload = payload;
                    existing.enqueuedAt = new Date().toISOString();
                    existing.lastError = error;
                    saveToStorage(this.queue);
                    return;
                }
            }

            const item: QueueItem = {
                id: crypto.randomUUID(),
                type,
                payload,
                enqueuedAt: new Date().toISOString(),
                retries: 0,
                lastError: error
            };
            this.queue.push(item);
            saveToStorage(this.queue);
        },

        removeItem(id: string) {
            this.queue = this.queue.filter((item) => item.id !== id);
            saveToStorage(this.queue);
        },

        clearAll() {
            this.queue = [];
            saveToStorage(this.queue);
        },

        /**
         * Retry a specific item. The caller passes a handler function that
         * receives the payload and returns a Promise<error | null>.
         */
        async retryItem(id: string, handler: (payload: Record<string, unknown>) => Promise<unknown>) {
            const item = this.queue.find((q) => q.id === id);
            if (!item) return;

            item.retries += 1;
            try {
                const error = await handler(item.payload);
                if (!error) {
                    this.removeItem(id);
                } else {
                    item.lastError = error.message ?? String(error);
                    saveToStorage(this.queue);
                }
            } catch (e) {
                item.lastError = e.message ?? String(e);
                saveToStorage(this.queue);
            }
        },

        /**
         * Attempt to retry all queued items using the provided type-keyed handlers.
         */
        async retryAll(handlers: Record<string, (payload: Record<string, unknown>) => Promise<unknown>>) {
            if (this.isRetrying) return;
            this.isRetrying = true;

            const ids = [...this.queue.map((q) => q.id)];
            for (const id of ids) {
                const item = this.queue.find((q) => q.id === id);
                if (!item) continue;
                const handler = handlers[item.type];
                if (handler) {
                    await this.retryItem(id, handler);
                }
            }

            this.isRetrying = false;
        }
    }
});
