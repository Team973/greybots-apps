import { supabase } from '@greybots/common/supabase/client';
import { db, getMeta, setMeta } from '@/lib/db';
import { syncedTables } from './registry';
import type { SyncedRecord, SyncedTableDef } from './types';

const pushBatchSize = 200;
const pullPageSize = 500;
// Re-read this much history before the saved cursor on every pull, to catch
// rows from transactions that committed after a later-stamped row was seen.
// Merging is idempotent, so the overlap is harmless.
const pullOverlapMs = 60_000;

export interface SyncResult {
    pushed: number;
    pulled: number;
}

function cursorKey(def: SyncedTableDef) {
    return `sync_cursor:${def.table}`;
}

function toRemote(row: SyncedRecord): Record<string, unknown> {
    // synced_at is server-owned; _dirty is local bookkeeping.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _dirty, synced_at, ...rest } = row;
    return rest;
}

function isNewer(a: string, b: string) {
    return Date.parse(a) > Date.parse(b);
}

async function pushTable(def: SyncedTableDef): Promise<number> {
    const table = db.syncedTable(def.table);
    const dirty = await table.where('_dirty').equals(1).toArray();

    for (let i = 0; i < dirty.length; i += pushBatchSize) {
        const batch = dirty.slice(i, i + pushBatchSize);
        const { error } = await supabase.from(def.remote).upsert(batch.map(toRemote), { onConflict: 'id' });
        if (error) throw new Error(`Push to ${def.remote} failed: ${error.message}`);

        // Only clear the flag on rows that weren't edited again mid-push.
        await db.transaction('rw', table, async () => {
            for (const row of batch) {
                const current = await table.get(row.id);
                if (current && current.updated_at === row.updated_at) {
                    await table.update(row.id, { _dirty: 0 });
                }
            }
        });
    }
    return dirty.length;
}

async function pullTable(def: SyncedTableDef): Promise<number> {
    const table = db.syncedTable(def.table);
    const savedCursor = await getMeta<string>(cursorKey(def));
    let cursor = savedCursor;
    let pulled = 0;
    let firstPage = true;

    for (;;) {
        let query = supabase
            .from(def.remote)
            .select('*')
            .order('synced_at', { ascending: true })
            .order('id', { ascending: true })
            .limit(pullPageSize);
        if (cursor && firstPage) {
            query = query.gte('synced_at', new Date(Date.parse(cursor) - pullOverlapMs).toISOString());
        } else if (cursor) {
            query = query.gt('synced_at', cursor);
        }

        const { data, error } = await query;
        if (error) throw new Error(`Pull from ${def.remote} failed: ${error.message}`);
        const rows = (data ?? []) as SyncedRecord[];

        await db.transaction('rw', table, async () => {
            for (const remote of rows) {
                const local = await table.get(remote.id);
                // A newer unpushed local edit wins; it goes up on the next push.
                if (local?._dirty && isNewer(local.updated_at, remote.updated_at)) continue;
                await table.put({ ...remote, _dirty: 0 });
            }
        });

        pulled += rows.length;
        firstPage = false;
        const last = rows[rows.length - 1]?.synced_at;
        if (last && (!cursor || isNewer(last, cursor))) cursor = last;
        if (rows.length < pullPageSize || !last) break;
    }

    if (cursor && cursor !== savedCursor) await setMeta(cursorKey(def), cursor);
    return pulled;
}

// Push local edits, then pull remote changes, for every registered table.
export async function syncAll(): Promise<SyncResult> {
    const result: SyncResult = { pushed: 0, pulled: 0 };
    for (const def of syncedTables) {
        result.pushed += await pushTable(def);
        result.pulled += await pullTable(def);
    }
    return result;
}

export async function countPendingChanges(): Promise<number> {
    let count = 0;
    for (const def of syncedTables) {
        count += await db.syncedTable(def.table).where('_dirty').equals(1).count();
    }
    return count;
}
