import { db } from '@/lib/db';
import { deleteRecord, saveRecord } from '@/lib/sync/local-repo';
import { uuidFromName } from '@/lib/uuid';
import type { ActiveEvent, ScheduleCategory, ScheduleItem, Setting } from './types';

export const settingsTable = 'settings';
export const scheduleTable = 'scheduleItems';
const activeEventKey = 'active_event';

// --- Active event ---------------------------------------------------------

export async function getActiveEvent(): Promise<ActiveEvent | null> {
    const row = await db.syncedTable<Setting<ActiveEvent>>(settingsTable).where('key').equals(activeEventKey).first();
    return row && !row.deleted ? row.value : null;
}

export async function saveActiveEvent(value: ActiveEvent, editorName: string | null): Promise<void> {
    await saveRecord<Setting<ActiveEvent>>(settingsTable, {
        id: await uuidFromName(`setting:${activeEventKey}`),
        key: activeEventKey,
        value,
        updated_by_name: editorName
    });
}

// --- Schedule items -------------------------------------------------------

export function listScheduleItems(eventKey: string): Promise<ScheduleItem[]> {
    return db
        .syncedTable<ScheduleItem>(scheduleTable)
        .where('event_key')
        .equals(eventKey)
        .filter((item) => !item.deleted)
        .toArray();
}

export interface CustomEventInput {
    id?: string;
    title: string;
    category: ScheduleCategory;
    notes: string | null;
    start_at: string;
    end_at: string;
}

export function validateCustomEvent(input: CustomEventInput): string | null {
    if (!input.title.trim()) return 'Title is required';
    const start = Date.parse(input.start_at);
    const end = Date.parse(input.end_at);
    if (Number.isNaN(start) || Number.isNaN(end)) return 'Start and end times are required';
    if (end <= start) return 'End time must be after the start time';
    return null;
}

export async function saveCustomEvent(eventKey: string, input: CustomEventInput, editorName: string | null) {
    const error = validateCustomEvent(input);
    if (error) throw new Error(error);
    return saveRecord<ScheduleItem>(scheduleTable, {
        id: input.id,
        event_key: eventKey,
        kind: 'custom',
        category: input.category,
        title: input.title.trim(),
        notes: input.notes?.trim() || null,
        start_at: new Date(input.start_at).toISOString(),
        end_at: new Date(input.end_at).toISOString(),
        match_key: null,
        match_info: null,
        updated_by_name: editorName
    });
}

// Move or resize an existing item (from calendar drag/resize).
export async function rescheduleItem(item: ScheduleItem, start: Date, end: Date, editorName: string | null) {
    return saveRecord<ScheduleItem>(scheduleTable, {
        ...item,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        updated_by_name: editorName
    });
}

export function deleteScheduleItem(id: string) {
    return deleteRecord(scheduleTable, id);
}
