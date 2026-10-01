import { clockNow } from '@greybots/common/lib/now';
import { db } from '@/lib/db';
import { deleteRecord, patchRecord, saveRecord } from '@/lib/sync/local-repo';
import type { SyncedRecord } from '@/lib/sync/types';
import type { ChecklistDef } from './config';

export const checklistRunsTable = 'checklistRuns';

// One run of an ad-hoc checklist (PreflightChecklistRun), e.g. this morning's
// "Start of day". Its checked steps are PreflightChecklistCheck rows with
// run_id = this row's id. (Runs of the standard pit sequence don't have a row
// here: the robot status log already records when each one started.)
export interface ChecklistRun extends SyncedRecord {
    event_key: string;
    checklist_id: string;
    checklist_name: string;
    // The checklist as it was when the run started, so editing the template
    // later doesn't change a run in progress or the history.
    snapshot: ChecklistDef;
    // The match (or "Qual 9 → Qual 14") this run belongs to, for display.
    label: string | null;
    match_key: string | null;
    started_at: string;
    started_by_name: string | null;
    completed_at: string | null;
    completed_by_name: string | null;
    updated_by_name: string | null;
}

const nowIso = () => new Date(clockNow()).toISOString();

// Newest first.
export async function listChecklistRuns(eventKey: string): Promise<ChecklistRun[]> {
    const rows = await db
        .syncedTable<ChecklistRun>(checklistRunsTable)
        .where('event_key')
        .equals(eventKey)
        .filter((r) => !r.deleted)
        .toArray();
    return rows.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
}

export function startChecklistRun(
    eventKey: string,
    checklist: ChecklistDef,
    link: { label: string | null; matchKey: string | null },
    editor: string | null
): Promise<ChecklistRun> {
    return saveRecord<ChecklistRun>(checklistRunsTable, {
        event_key: eventKey,
        checklist_id: checklist.id,
        checklist_name: checklist.name,
        snapshot: JSON.parse(JSON.stringify(checklist)) as ChecklistDef,
        label: link.label,
        match_key: link.matchKey,
        started_at: nowIso(),
        started_by_name: editor,
        completed_at: null,
        completed_by_name: null,
        updated_by_name: editor
    });
}

export function completeChecklistRun(id: string, editor: string | null) {
    return patchRecord<ChecklistRun>(checklistRunsTable, id, { completed_at: nowIso(), completed_by_name: editor, updated_by_name: editor });
}

// Abandon a run started by mistake.
export function deleteChecklistRun(id: string) {
    return deleteRecord(checklistRunsTable, id);
}
