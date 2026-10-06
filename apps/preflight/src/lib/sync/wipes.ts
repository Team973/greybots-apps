import { db } from '@/lib/db';
import type { SyncedRecord } from './types';

// Wiped events. Deletes are normally soft, so they reach the other devices,
// but an event's data is removed from the server for good once its report has
// been pulled (lib/report/wipe.ts). The `event_wipes` setting records when
// each event was wiped, and every device drops its own copy of that event's
// rows from before then. Anything recorded afterwards (the same event key
// used again) is kept.

// Local tables holding rows that belong to one event (they have `event_key`).
export const eventTables = ['scheduleItems', 'tasks', 'robotStatus', 'checklistChecks', 'checklistRuns', 'notes', 'repairs'];

export const eventWipesKey = 'event_wipes';
// Event key -> when it was wiped (ISO).
export type EventWipes = Record<string, string>;

type EventRow = SyncedRecord & { event_key: string };

// Read straight from the table (not through lib/settings.ts), so the sync
// engine can use this without importing the write helpers.
export async function getEventWipes(): Promise<EventWipes> {
    const row = await db.syncedTable<SyncedRecord & { key: string; value: EventWipes | null }>('settings').where('key').equals(eventWipesKey).first();
    return row && !row.deleted && row.value ? row.value : {};
}

// Removes this device's rows for one event from before `wipedAt`, including
// unpushed edits: pushing them would put the event back on the server.
export async function purgeEventLocally(eventKey: string, wipedAt: string): Promise<number> {
    const cutoff = Date.parse(wipedAt);
    let removed = 0;
    for (const name of eventTables) {
        const table = db.syncedTable<EventRow>(name);
        const ids = await table
            .where('event_key')
            .equals(eventKey)
            .filter((row) => Date.parse(row.updated_at) <= cutoff)
            .primaryKeys();
        if (ids.length) await table.bulkDelete(ids);
        removed += ids.length;
    }
    return removed;
}

// Applies every recorded wipe. Run by the sync engine once the settings have
// been pulled and before the other tables are pushed.
export async function applyEventWipes(): Promise<number> {
    let removed = 0;
    for (const [eventKey, wipedAt] of Object.entries(await getEventWipes())) {
        removed += await purgeEventLocally(eventKey, wipedAt);
    }
    return removed;
}
