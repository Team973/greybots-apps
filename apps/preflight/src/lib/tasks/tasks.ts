import { clockNow } from '@greybots/common/lib/now';
import { db } from '@/lib/db';
import { deleteRecord, patchRecord, saveRecord } from '@/lib/sync/local-repo';
import type { SyncedRecord } from '@/lib/sync/types';

export const tasksTable = 'tasks';

// A team operational task, e.g. "Swap battery" (issue #81).
export interface Task extends SyncedRecord {
    event_key: string;
    title: string;
    notes: string | null;
    sort_order: number;
    // Optional link to one of our matches (TBA match key).
    match_key: string | null;
    // Pit member the task is assigned to (free text).
    assignee: string | null;
    started_at: string | null;
    started_by_name: string | null;
    completed_at: string | null;
    completed_by_name: string | null;
    updated_by_name: string | null;
}

// Quick-add titles from the requirements doc (§2.1.4).
export const taskPresets = [
    'Replace drivetrain module',
    'Perform robot inspection',
    'Swap battery',
    'Repair subsystem',
    'Run automated robot test',
    'Driver practice',
    'Recalibrate sensors',
    'Prepare robot for queue',
    'Begin post-match inspection'
];

export async function listTasks(eventKey: string): Promise<Task[]> {
    const tasks = await db
        .syncedTable<Task>(tasksTable)
        .where('event_key')
        .equals(eventKey)
        .filter((t) => !t.deleted)
        .toArray();
    return tasks.sort((a, b) => a.sort_order - b.sort_order);
}

export interface TaskInput {
    title: string;
    notes: string | null;
    match_key: string | null;
    assignee?: string | null;
}

export async function createTask(eventKey: string, input: TaskInput, editor: string | null): Promise<Task> {
    const title = input.title.trim();
    if (!title) throw new Error('Title is required');
    const existing = await listTasks(eventKey);
    const last = existing[existing.length - 1];
    return saveRecord<Task>(tasksTable, {
        event_key: eventKey,
        title,
        notes: input.notes?.trim() || null,
        sort_order: last ? last.sort_order + 1 : 0,
        match_key: input.match_key,
        assignee: input.assignee?.trim() || null,
        started_at: null,
        started_by_name: null,
        completed_at: null,
        completed_by_name: null,
        updated_by_name: editor
    });
}

// Patches only the changed fields onto the stored task, so a slightly stale
// copy from the UI can't undo another just-saved edit.
function update(task: Task, changes: Partial<Task>, editor: string | null) {
    return patchRecord<Task>(tasksTable, task.id, { ...changes, updated_by_name: editor });
}

export function updateTaskDetails(task: Task, input: TaskInput, editor: string | null) {
    const title = input.title.trim();
    if (!title) throw new Error('Title is required');
    return update(task, { title, notes: input.notes?.trim() || null, match_key: input.match_key, assignee: input.assignee?.trim() || null }, editor);
}

export function startTask(task: Task, editor: string | null) {
    return update(task, { started_at: new Date(clockNow()).toISOString(), started_by_name: editor }, editor);
}

export function completeTask(task: Task, editor: string | null) {
    return update(task, { completed_at: new Date(clockNow()).toISOString(), completed_by_name: editor }, editor);
}

// Reopening keeps the start time (the work already began) but clears completion.
export function reopenTask(task: Task, editor: string | null) {
    return update(task, { completed_at: null, completed_by_name: null }, editor);
}

export function deleteTask(id: string) {
    return deleteRecord(tasksTable, id);
}

// Give the task dragged to `index` in `ordered` (the list after the move) a
// sort_order between its new neighbors, so only that one task is rewritten.
export function reorderTask(ordered: Task[], index: number, editor: string | null) {
    const prev = ordered[index - 1];
    const next = ordered[index + 1];
    let sortOrder: number;
    if (prev && next) sortOrder = (prev.sort_order + next.sort_order) / 2;
    else if (prev) sortOrder = prev.sort_order + 1;
    else if (next) sortOrder = next.sort_order - 1;
    else sortOrder = 0;
    return update(ordered[index], { sort_order: sortOrder }, editor);
}
