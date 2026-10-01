import { clockNow } from '@greybots/common/lib/now';
import { db } from '@/lib/db';
import { deleteRecord, patchRecord, saveRecord } from '@/lib/sync/local-repo';
import type { SyncedRecord } from '@/lib/sync/types';

export const repairsTable = 'repairs';

export type RepairStatus = 'open' | 'in_progress' | 'done';

export const repairStatusLabels: Record<RepairStatus, string> = {
    open: 'Open',
    in_progress: 'In progress',
    done: 'Done'
};

// Where the repair was logged from.
export type RepairSource = 'standalone' | 'task' | 'checklist';

// One repair or maintenance job (issue #83, PreflightRepair), tied where
// possible to a match, robot, subsystem, and component, so the log can answer
// "what was repaired after Qual 12?" or "what happened between these tests?".
export interface Repair extends SyncedRecord {
    event_key: string;
    // What's wrong / what's being done, in a few words.
    title: string;
    details: string | null;
    subsystem: string | null;
    // Free text until the parts inventory exists.
    component: string | null;
    robot: string | null;
    status: RepairStatus;
    // Who's doing the work: a name picked from lib/people.ts.
    assignee: string | null;
    match_key: string | null;
    // The task it was logged from, if any.
    task_id: string | null;
    // The pit visit (checklist run) it was found in, if any.
    run_id: string | null;
    source: RepairSource;
    reported_at: string;
    reported_by_name: string | null;
    started_at: string | null;
    started_by_name: string | null;
    finished_at: string | null;
    finished_by_name: string | null;
    updated_by_name: string | null;
}

const statusRank: Record<RepairStatus, number> = { in_progress: 0, open: 1, done: 2 };

// In progress first, then open, then done; oldest first within the first two
// (most urgent on top), most recently finished first among done.
export function sortRepairs(repairs: Repair[]): Repair[] {
    return [...repairs].sort((a, b) => {
        if (a.status !== b.status) return statusRank[a.status] - statusRank[b.status];
        if (a.status === 'done') return Date.parse(b.finished_at ?? b.updated_at) - Date.parse(a.finished_at ?? a.updated_at);
        return Date.parse(a.reported_at) - Date.parse(b.reported_at);
    });
}

export async function listRepairs(eventKey: string): Promise<Repair[]> {
    const repairs = await db
        .syncedTable<Repair>(repairsTable)
        .where('event_key')
        .equals(eventKey)
        .filter((r) => !r.deleted)
        .toArray();
    return sortRepairs(repairs);
}

// Repairs being worked right now, for the Overview and the pit display.
export function activeRepairs(repairs: Repair[]): Repair[] {
    return repairs.filter((r) => r.status === 'in_progress');
}

export interface RepairInput {
    title: string;
    details?: string | null;
    subsystem?: string | null;
    component?: string | null;
    robot?: string | null;
    assignee?: string | null;
    match_key?: string | null;
}

export interface RepairOrigin {
    source: RepairSource;
    task_id?: string | null;
    run_id?: string | null;
    // Start the work right away (e.g. logged while repairs are under way).
    start?: boolean;
}

const clean = (value: string | null | undefined) => value?.trim() || null;
const nowIso = () => new Date(clockNow()).toISOString();

export async function createRepair(
    eventKey: string,
    input: RepairInput,
    editor: string | null,
    origin: RepairOrigin = { source: 'standalone' }
): Promise<Repair> {
    const title = input.title.trim();
    if (!title) throw new Error("Say what's being repaired");
    const now = nowIso();
    return saveRecord<Repair>(repairsTable, {
        event_key: eventKey,
        title,
        details: clean(input.details),
        subsystem: clean(input.subsystem),
        component: clean(input.component),
        robot: clean(input.robot),
        status: origin.start ? 'in_progress' : 'open',
        assignee: clean(input.assignee),
        match_key: input.match_key ?? null,
        task_id: origin.task_id ?? null,
        run_id: origin.run_id ?? null,
        source: origin.source,
        reported_at: now,
        reported_by_name: editor,
        started_at: origin.start ? now : null,
        started_by_name: origin.start ? editor : null,
        finished_at: null,
        finished_by_name: null,
        updated_by_name: editor
    });
}

function update(id: string, changes: Partial<Repair>, editor: string | null) {
    return patchRecord<Repair>(repairsTable, id, { ...changes, updated_by_name: editor });
}

export function updateRepairDetails(id: string, input: RepairInput, editor: string | null) {
    const title = input.title.trim();
    if (!title) throw new Error("Say what's being repaired");
    return update(
        id,
        {
            title,
            details: clean(input.details),
            subsystem: clean(input.subsystem),
            component: clean(input.component),
            robot: clean(input.robot),
            assignee: clean(input.assignee),
            match_key: input.match_key ?? null
        },
        editor
    );
}

// Whoever starts an unassigned repair takes it.
export function startRepairWork(repair: Repair, editor: string | null) {
    return update(
        repair.id,
        { status: 'in_progress', started_at: nowIso(), started_by_name: editor, assignee: repair.assignee ?? editor },
        editor
    );
}

// Finishing a repair that was never started counts as started just now.
export function finishRepair(repair: Repair, editor: string | null) {
    const now = nowIso();
    return update(
        repair.id,
        {
            status: 'done',
            started_at: repair.started_at ?? now,
            started_by_name: repair.started_at ? repair.started_by_name : editor,
            finished_at: now,
            finished_by_name: editor
        },
        editor
    );
}

// Reopening keeps the start (the work already began) but clears completion.
export function reopenRepair(repair: Repair, editor: string | null) {
    return update(repair.id, { status: repair.started_at ? 'in_progress' : 'open', finished_at: null, finished_by_name: null }, editor);
}

export function deleteRepair(id: string) {
    return deleteRecord(repairsTable, id);
}

export async function repairForTask(taskId: string): Promise<Repair | null> {
    const rows = await db.syncedTable<Repair>(repairsTable).filter((r) => !r.deleted && r.task_id === taskId).toArray();
    return rows[0] ?? null;
}
