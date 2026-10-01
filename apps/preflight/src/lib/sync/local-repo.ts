import { db } from '@/lib/db';
import { useSyncStore } from '@/stores/sync-store';
import type { SyncedRecord } from './types';

type Editable<T extends SyncedRecord> = Omit<T, 'updated_at' | 'deleted' | 'synced_at' | '_dirty' | 'id'> & { id?: string };

// All feature code should write synced tables through these helpers so the
// bookkeeping fields stay correct and the change gets queued for push.

export async function saveRecord<T extends SyncedRecord>(table: string, record: Editable<T>): Promise<T> {
    const existing = record.id ? await db.syncedTable<T>(table).get(record.id) : undefined;
    const row = {
        ...existing,
        ...record,
        id: record.id ?? crypto.randomUUID(),
        updated_at: new Date().toISOString(),
        deleted: false,
        _dirty: 1
    } as T;
    await db.syncedTable<T>(table).put(row);
    useSyncStore().notifyLocalChange();
    return row;
}

// Update only the given fields of an existing row, reading the current row
// from the database first. Prefer this over saveRecord({ ...row, ...changes })
// when `row` came from the UI, since that copy may be stale (e.g. a change
// saved a moment ago that the live query hasn't delivered yet).
export async function patchRecord<T extends SyncedRecord>(
    table: string,
    id: string,
    changes: Partial<Omit<T, 'id' | 'updated_at' | 'deleted' | 'synced_at' | '_dirty'>>
): Promise<T> {
    const current = await db.syncedTable<T>(table).get(id);
    if (!current || current.deleted) throw new Error('This item no longer exists');
    const row = { ...current, ...changes, updated_at: new Date().toISOString(), _dirty: 1 } as T;
    await db.syncedTable<T>(table).put(row);
    useSyncStore().notifyLocalChange();
    return row;
}

export async function deleteRecord(table: string, id: string): Promise<void> {
    const updated = await db.syncedTable(table).update(id, {
        deleted: true,
        updated_at: new Date().toISOString(),
        _dirty: 1
    });
    if (updated) useSyncStore().notifyLocalChange();
}

// Non-deleted rows of a synced table (use with useLiveQuery for reactivity).
export function activeRecords<T extends SyncedRecord>(table: string) {
    return db.syncedTable<T>(table).filter((row) => !row.deleted);
}
