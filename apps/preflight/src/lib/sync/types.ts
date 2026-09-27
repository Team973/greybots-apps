// Every table that syncs between the device and Supabase shares this shape.
// See docs/architecture.md ("Adding a synced table") for the matching
// server-side columns and trigger.
export interface SyncedRecord {
    id: string;
    // Client-set time of the last edit. Used for last-write-wins conflicts.
    updated_at: string;
    // Soft-delete flag, so deletions propagate to other devices.
    deleted: boolean;
    // Server-set (by trigger) time the row last changed on the server. Used as
    // the pull cursor. Null/absent for rows that have never been pushed.
    synced_at?: string | null;
    // Local-only: 1 when the row has edits that haven't been pushed yet.
    // (A number rather than a boolean because IndexedDB can't index booleans.)
    _dirty: 0 | 1;
}

export interface SyncedTableDef {
    // Dexie (local) table name.
    table: string;
    // Supabase (remote) table name.
    remote: string;
    // Extra Dexie indexes beyond the built-in id/_dirty/synced_at.
    indexes?: string[];
}
