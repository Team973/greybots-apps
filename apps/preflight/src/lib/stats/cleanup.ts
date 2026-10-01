import { checksTable, type ChecklistCheck } from '@/lib/checklists/checks';
import { checklistRunsTable, type ChecklistRun } from '@/lib/checklists/runs';
import { db } from '@/lib/db';
import { robotStatusTable, type RobotStatusEntry } from '@/lib/robot-status/robot-status';
import { deleteRecord } from '@/lib/sync/local-repo';
import type { Turnaround } from './pit-stats';

// Removing timing data that shouldn't count (admins): a turnaround that ran
// all night because nobody ended the day, or everything from before a given
// match. Deletes are soft, like every other delete, so they reach the other
// devices.
//
// The newest status entry is never deleted: it's the pit's current state, and
// removing it would silently move the robot back to an older status.

async function newestEntryId(eventKey: string): Promise<string | null> {
    const entries = await db.syncedTable<RobotStatusEntry>(robotStatusTable).where('event_key').equals(eventKey).toArray();
    const live = entries.filter((e) => !e.deleted);
    live.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || Date.parse(b.set_at) - Date.parse(a.set_at));
    return live[0]?.id ?? null;
}

// Removes one turnaround from the stats: its status entries and the steps
// checked during it.
export async function deleteTurnaround(eventKey: string, turnaround: Turnaround): Promise<void> {
    const keep = await newestEntryId(eventKey);
    for (const id of turnaround.entryIds) {
        if (id !== keep) await deleteRecord(robotStatusTable, id);
    }
    const runs = new Set(turnaround.runIds);
    const checks = await db.syncedTable<ChecklistCheck>(checksTable).where('event_key').equals(eventKey).toArray();
    for (const check of checks) {
        if (!check.deleted && runs.has(check.run_id)) await deleteRecord(checksTable, check.id);
    }
}

export interface ClearCounts {
    statusEntries: number;
    checks: number;
    checklistRuns: number;
}

async function rowsBefore(eventKey: string, cutoff: number) {
    const keep = await newestEntryId(eventKey);
    const before = (iso: string | null | undefined) => !!iso && Date.parse(iso) < cutoff;
    const statusEntries = (await db.syncedTable<RobotStatusEntry>(robotStatusTable).where('event_key').equals(eventKey).toArray()).filter(
        (e) => !e.deleted && e.id !== keep && before(e.set_at)
    );
    const checks = (await db.syncedTable<ChecklistCheck>(checksTable).where('event_key').equals(eventKey).toArray()).filter(
        (c) => !c.deleted && before(c.completed_at ?? c.updated_at)
    );
    const checklistRuns = (await db.syncedTable<ChecklistRun>(checklistRunsTable).where('event_key').equals(eventKey).toArray()).filter(
        (r) => !r.deleted && before(r.started_at)
    );
    return { statusEntries, checks, checklistRuns };
}

// What clearBefore() would remove, to show before asking for confirmation.
export async function countBefore(eventKey: string, cutoffIso: string): Promise<ClearCounts> {
    const rows = await rowsBefore(eventKey, Date.parse(cutoffIso));
    return { statusEntries: rows.statusEntries.length, checks: rows.checks.length, checklistRuns: rows.checklistRuns.length };
}

// Removes the timing data recorded before a moment (e.g. the start of a
// match): status log entries, checked steps, and ad-hoc checklist runs.
// Repairs, tasks, notes, and batteries are left alone.
export async function clearBefore(eventKey: string, cutoffIso: string): Promise<ClearCounts> {
    const rows = await rowsBefore(eventKey, Date.parse(cutoffIso));
    for (const entry of rows.statusEntries) await deleteRecord(robotStatusTable, entry.id);
    for (const check of rows.checks) await deleteRecord(checksTable, check.id);
    for (const run of rows.checklistRuns) await deleteRecord(checklistRunsTable, run.id);
    return { statusEntries: rows.statusEntries.length, checks: rows.checks.length, checklistRuns: rows.checklistRuns.length };
}
