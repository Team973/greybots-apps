import { clockNow } from '@greybots/common/lib/now';
import { db } from '@/lib/db';
import { deleteRecord, patchRecord, saveRecord } from '@/lib/sync/local-repo';
import type { SyncedRecord } from '@/lib/sync/types';

export const notesTable = 'notes';

// A quick, timestamped pit note (issue #88).
export interface Note extends SyncedRecord {
    event_key: string;
    title: string;
    body: string;
    sort_order: number;
    // Optional links: one of our matches (TBA match key), a robot, a subsystem.
    match_key: string | null;
    robot: string | null;
    subsystem: string | null;
    // When the note was taken (on the app clock).
    noted_at: string;
    created_by_name: string | null;
    updated_by_name: string | null;
}

export async function listNotes(eventKey: string): Promise<Note[]> {
    const notes = await db
        .syncedTable<Note>(notesTable)
        .where('event_key')
        .equals(eventKey)
        .filter((n) => !n.deleted)
        .toArray();
    return notes.sort((a, b) => a.sort_order - b.sort_order);
}

export interface NoteInput {
    title: string;
    body: string;
    match_key: string | null;
    robot: string | null;
    subsystem: string | null;
}

// New notes go to the top of the list.
export async function createNote(eventKey: string, input: Partial<NoteInput>, editor: string | null): Promise<Note> {
    const [first] = await listNotes(eventKey);
    return saveRecord<Note>(notesTable, {
        event_key: eventKey,
        title: input.title?.trim() ?? '',
        body: input.body ?? '',
        sort_order: first ? first.sort_order - 1 : 0,
        match_key: input.match_key ?? null,
        robot: input.robot?.trim() || null,
        subsystem: input.subsystem?.trim() || null,
        noted_at: new Date(clockNow()).toISOString(),
        created_by_name: editor,
        updated_by_name: editor
    });
}

export function updateNote(id: string, input: NoteInput, editor: string | null) {
    return patchRecord<Note>(notesTable, id, {
        title: input.title.trim(),
        body: input.body,
        match_key: input.match_key,
        robot: input.robot?.trim() || null,
        subsystem: input.subsystem?.trim() || null,
        updated_by_name: editor
    });
}

export function deleteNote(id: string) {
    return deleteRecord(notesTable, id);
}

// Give the note dragged to `index` in `ordered` (the list after the move) a
// sort_order between its new neighbors, so only that one note is rewritten.
export function reorderNote(ordered: Note[], index: number, editor: string | null) {
    const prev = ordered[index - 1];
    const next = ordered[index + 1];
    let sortOrder: number;
    if (prev && next) sortOrder = (prev.sort_order + next.sort_order) / 2;
    else if (prev) sortOrder = prev.sort_order + 1;
    else if (next) sortOrder = next.sort_order - 1;
    else sortOrder = 0;
    return patchRecord<Note>(notesTable, ordered[index].id, { sort_order: sortOrder, updated_by_name: editor });
}

// "9/18 - 8:33", as in the Notes mockup.
export function formatNoteTime(iso: string): string {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} - ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
