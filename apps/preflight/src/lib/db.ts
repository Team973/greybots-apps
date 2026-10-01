import Dexie, { type Table } from 'dexie';
import { databaseName } from './constants';
import type { KioskRole } from './roles';
import { syncedTables } from './sync/registry';
import type { SyncedRecord } from './sync/types';

// Bump whenever the store definitions below or the synced table registry
// change. Dexie runs the upgrade automatically on next launch.
const schemaVersion = 6;

export interface MetaRow {
    key: string;
    value: unknown;
}

// A local-only pit crew account used for kiosk-mode sign-in. Never synced.
export interface KioskUser {
    id: string;
    name: string;
    role: KioskRole;
    pinHash: string;
    pinSalt: string;
    createdAt: string;
}

class PreflightDatabase extends Dexie {
    meta!: Table<MetaRow, string>;
    kioskUsers!: Table<KioskUser, string>;

    constructor() {
        super(databaseName);

        const stores: Record<string, string> = {
            meta: 'key',
            kioskUsers: 'id, name'
        };
        for (const def of syncedTables) {
            stores[def.table] = ['id', '_dirty', 'synced_at', ...(def.indexes ?? [])].join(', ');
        }
        this.version(schemaVersion).stores(stores);
    }

    syncedTable<T extends SyncedRecord = SyncedRecord>(name: string): Table<T, string> {
        return this.table(name);
    }
}

export const db = new PreflightDatabase();

export async function getMeta<T>(key: string): Promise<T | undefined> {
    const row = await db.meta.get(key);
    return row?.value as T | undefined;
}

export async function setMeta<T>(key: string, value: T): Promise<void> {
    await db.meta.put({ key, value });
}

export async function deleteMeta(key: string): Promise<void> {
    await db.meta.delete(key);
}

// Ask the browser not to evict our data under storage pressure. Important
// for a device that may go days between syncs.
export async function requestPersistentStorage(): Promise<boolean> {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return navigator.storage.persist();
}

export async function isStoragePersistent(): Promise<boolean> {
    return (await navigator.storage?.persisted?.()) ?? false;
}
