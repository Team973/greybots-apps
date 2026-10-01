import { defineStore } from 'pinia';
import { supabase } from '@greybots/common/supabase/client';
import { getMeta, setMeta, deleteMeta } from '@/lib/db';
import { localChangeSyncDelayMs, syncIntervalMs } from '@/lib/constants';
import { countPendingChanges, syncAll } from '@/lib/sync/engine';
import { isServerReachable, signInAccount, signOutAccount, type AccountProfile } from '@/lib/greybots-account';
import { refreshAccountDirectory } from '@/lib/people';
import { hasRole } from '@/lib/roles';
import { getActiveEvent } from '@/lib/schedule/schedule-repo';
import { refreshScoutingCompletion } from '@/lib/schedule/scouting';

export type SyncStatus = 'offline' | 'unlinked' | 'syncing' | 'error' | 'pending' | 'synced';

const lastSyncKey = 'last_sync_at';
// The greybots-apps account a kiosk device syncs as.
const linkedAccountKey = 'linked_account';

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let localChangeTimer: ReturnType<typeof setTimeout> | null = null;

export const useSyncStore = defineStore('sync', {
    state() {
        return {
            online: navigator.onLine,
            // Result of the last server probe/sync; null until first checked.
            reachable: null as boolean | null,
            hasServerSession: false,
            linkedAccount: null as AccountProfile | null,
            syncing: false,
            lastSyncAt: null as string | null,
            lastError: null as string | null,
            pendingCount: 0
        };
    },
    getters: {
        status(): SyncStatus {
            if (!this.online || this.reachable === false) return 'offline';
            if (!this.hasServerSession) return 'unlinked';
            if (this.syncing) return 'syncing';
            if (this.lastError) return 'error';
            if (this.pendingCount > 0) return 'pending';
            return 'synced';
        }
    },
    actions: {
        async init() {
            this.lastSyncAt = (await getMeta<string>(lastSyncKey)) ?? null;
            this.linkedAccount = (await getMeta<AccountProfile>(linkedAccountKey)) ?? null;
            const { data } = await supabase.auth.getSession();
            this.hasServerSession = !!data.session;
            supabase.auth.onAuthStateChange((_event, session) => {
                this.hasServerSession = !!session;
            });

            window.addEventListener('online', () => {
                this.online = true;
                this.syncNow();
            });
            window.addEventListener('offline', () => {
                this.online = false;
            });

            if (!intervalHandle) intervalHandle = setInterval(() => this.syncNow(), syncIntervalMs);
            await this.refreshPending();
            this.syncNow();
        },

        async refreshPending() {
            this.pendingCount = await countPendingChanges();
        },

        // Called by the local-repo helpers after every local write.
        notifyLocalChange() {
            this.refreshPending();
            if (localChangeTimer) clearTimeout(localChangeTimer);
            localChangeTimer = setTimeout(() => this.syncNow(), localChangeSyncDelayMs);
        },

        async syncNow() {
            if (this.syncing) return;
            this.online = navigator.onLine;
            if (!this.online || !this.hasServerSession) return;

            this.syncing = true;
            try {
                this.reachable = await isServerReachable();
                if (!this.reachable) return;
                await syncAll();
                // Who has an account, for the person pickers. Kept on the
                // device so the list still works offline.
                await refreshAccountDirectory().catch((e) => console.warn(e));
                // Which of our matches GreyScout has scouting data for. Not
                // worth failing the sync over.
                const event = await getActiveEvent();
                if (event) await refreshScoutingCompletion(event.event_key).catch((e) => console.warn(e));
                this.lastError = null;
                this.lastSyncAt = new Date().toISOString();
                await setMeta(lastSyncKey, this.lastSyncAt);
            } catch (e) {
                this.lastError = e instanceof Error ? e.message : String(e);
            } finally {
                this.syncing = false;
                await this.refreshPending();
            }
        },

        // Kiosk mode: sign a lead/admin greybots-apps account into the device
        // so it can sync. Local users never see or use this account directly.
        async linkAccount(email: string, password: string) {
            const profile = await signInAccount(email, password);
            if (!hasRole(profile.role, 'lead')) {
                await signOutAccount();
                throw new Error('Only leads and admins can link a kiosk device');
            }
            await setMeta(linkedAccountKey, profile);
            this.linkedAccount = profile;
            this.hasServerSession = true;
            // A newly linked kiosk picks up the account directory right away.
            refreshAccountDirectory(true).catch((e) => console.warn(e));
            this.syncNow();
        },

        async unlinkAccount() {
            await signOutAccount();
            await deleteMeta(linkedAccountKey);
            this.linkedAccount = null;
            this.hasServerSession = false;
        }
    }
});
