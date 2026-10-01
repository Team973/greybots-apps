import { db } from '@/lib/db';
import { clockNow } from '@greybots/common/lib/now';
import { patchRecord, saveRecord } from '@/lib/sync/local-repo';
import type { SyncedRecord } from '@/lib/sync/types';
import { uuidFromName } from '@/lib/uuid';
import type { ChecklistDef, ChecklistStep } from './config';

export const checksTable = 'checklistChecks';

// A checked-off checklist step within one pit run (PreflightChecklistCheck).
// Its id is derived from run + checklist + step, so two devices checking the
// same step converge on one row.
export interface ChecklistCheck extends SyncedRecord {
    event_key: string;
    run_id: string;
    checklist_id: string;
    checklist_name: string | null;
    step_id: string;
    step_title: string | null;
    completed_at: string | null;
    completed_by_name: string | null;
    updated_by_name: string | null;
}

function checkId(runId: string, checklistId: string, stepId: string) {
    return uuidFromName(`check:${runId}:${checklistId}:${stepId}`);
}

export async function listChecks(eventKey: string, runId: string): Promise<ChecklistCheck[]> {
    const rows = await db.syncedTable<ChecklistCheck>(checksTable).where('event_key').equals(eventKey).toArray();
    return rows.filter((r) => r.run_id === runId && !r.deleted);
}

export function isStepDone(checks: ChecklistCheck[], checklistId: string, stepId: string): boolean {
    return checks.some((c) => c.checklist_id === checklistId && c.step_id === stepId && c.completed_at);
}

// Index of the first unchecked step: steps must be done in order.
export function nextStepIndex(checks: ChecklistCheck[], checklist: ChecklistDef): number {
    const index = checklist.steps.findIndex((s) => !isStepDone(checks, checklist.id, s.id));
    return index === -1 ? checklist.steps.length : index;
}

export async function checkStep(
    eventKey: string,
    runId: string,
    checklist: ChecklistDef,
    step: ChecklistStep,
    editor: string | null
) {
    return saveRecord<ChecklistCheck>(checksTable, {
        id: await checkId(runId, checklist.id, step.id),
        event_key: eventKey,
        run_id: runId,
        checklist_id: checklist.id,
        checklist_name: checklist.name,
        step_id: step.id,
        step_title: step.title,
        completed_at: new Date(clockNow()).toISOString(),
        completed_by_name: editor,
        updated_by_name: editor
    });
}

export async function uncheckStep(runId: string, checklist: ChecklistDef, step: ChecklistStep, editor: string | null) {
    return patchRecord<ChecklistCheck>(checksTable, await checkId(runId, checklist.id, step.id), {
        completed_at: null,
        completed_by_name: null,
        updated_by_name: editor
    });
}
