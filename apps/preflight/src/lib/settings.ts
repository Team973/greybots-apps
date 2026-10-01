import { db } from '@/lib/db';
import { saveRecord } from '@/lib/sync/local-repo';
import type { SyncedRecord } from '@/lib/sync/types';
import { uuidFromName } from '@/lib/uuid';

// Shared key/value settings (the PreflightSetting table): one row per key,
// with an id derived from the key so every device writes the same row.
// Members can read them; only leads and admins can change them.

export const settingsTable = 'settings';

export interface Setting<T = unknown> extends SyncedRecord {
    key: string;
    value: T;
    updated_by_name: string | null;
}

export async function getSetting<T>(key: string): Promise<T | null> {
    const row = await db.syncedTable<Setting<T>>(settingsTable).where('key').equals(key).first();
    return row && !row.deleted ? row.value : null;
}

export async function saveSetting<T>(key: string, value: T, editorName: string | null): Promise<void> {
    await saveRecord<Setting<T>>(settingsTable, {
        id: await uuidFromName(`setting:${key}`),
        key,
        value,
        updated_by_name: editorName
    });
}
