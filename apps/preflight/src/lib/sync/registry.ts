import type { SyncedTableDef } from './types';

// Tables that sync with Supabase. Adding an entry here creates the local
// Dexie table and includes it in push/pull. Bump `schemaVersion` in
// lib/db.ts whenever this list (or an entry's indexes) changes.
export const syncedTables: SyncedTableDef[] = [
    { table: 'settings', remote: 'PreflightSetting', indexes: ['key'] },
    { table: 'scheduleItems', remote: 'PreflightScheduleItem', indexes: ['event_key'] }
];
