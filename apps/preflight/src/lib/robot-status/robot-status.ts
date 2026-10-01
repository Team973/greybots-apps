import { db } from '@/lib/db';
import type { ChecklistSequence } from '@/lib/checklists/config';
import type { ScheduleItem } from '@/lib/schedule/types';
import { saveRecord } from '@/lib/sync/local-repo';
import type { SyncedRecord } from '@/lib/sync/types';

export const robotStatusTable = 'robotStatus';

// The pit flow (issues #82, #84, #86):
//   Inbound (match over) -> Robot arrived -> Pending checklist 1..N
//   -> Robot Ready -> Robot departed -> Away -> (match ends) -> Inbound
export type RobotStatus = 'inbound' | 'pending' | 'ready' | 'away';

export const robotStatuses: RobotStatus[] = ['inbound', 'pending', 'ready', 'away'];

export const robotStatusLabels: Record<RobotStatus, string> = {
    inbound: 'Inbound',
    pending: 'Pending',
    ready: 'Robot Ready',
    away: 'Away'
};

// Background and text colors (mockup: pending = yellow).
export const robotStatusColors: Record<RobotStatus, { bg: string; fg: string }> = {
    inbound: { bg: '#6d4fb3', fg: '#ffffff' },
    pending: { bg: '#ffc107', fg: '#1a1a1a' },
    ready: { bg: '#2e7d32', fg: '#ffffff' },
    away: { bg: '#1565c0', fg: '#ffffff' }
};

// One entry in the append-only status log. The newest entry is the current
// status, so devices never overwrite each other and history comes for free.
export interface RobotStatusEntry extends SyncedRecord {
    event_key: string;
    status: RobotStatus;
    // The active checklist's name (status 'pending'), for display/history.
    pending_label: string | null;
    note: string | null;
    set_at: string;
    set_by_name: string | null;
    // The pit visit this entry belongs to (from arrival onward).
    run_id: string | null;
    // Active checklist in the sequence (status 'pending'), 0-based.
    checklist_index: number | null;
    // The match the robot left for (status 'away').
    match_key: string | null;
    updated_by_name: string | null;
}

// Rows written before 'in_pit' was renamed may still be on a device until it
// pulls the migrated rows.
function normalize(entry: RobotStatusEntry): RobotStatusEntry {
    return (entry.status as string) === 'in_pit' ? { ...entry, status: 'inbound' } : entry;
}

// Newest first.
export async function listStatusHistory(eventKey: string): Promise<RobotStatusEntry[]> {
    const entries = await db
        .syncedTable<RobotStatusEntry>(robotStatusTable)
        .where('event_key')
        .equals(eventKey)
        .filter((e) => !e.deleted)
        .toArray();
    return entries.map(normalize).sort((a, b) => Date.parse(b.set_at) - Date.parse(a.set_at));
}

export function statusText(entry: Pick<RobotStatusEntry, 'status' | 'pending_label'> | null): string {
    if (!entry) return robotStatusLabels.inbound;
    if (entry.status === 'pending' && entry.pending_label) return `Pending ${entry.pending_label}`;
    return robotStatusLabels[entry.status];
}

export interface EffectiveStatus {
    status: RobotStatus;
    // When the robot entered this status; null when unknown (no history yet).
    since: string | null;
    entry: RobotStatusEntry | null;
    // True when Away became Inbound because the robot's match ended, without
    // anyone pressing "Match over" (nothing is written for this).
    autoInbound: boolean;
    // For Away: the match the robot left for.
    match: ScheduleItem | null;
}

// The status to show right now. With no history the robot is waiting to come
// in (Inbound). An Away robot becomes Inbound on its own once the match it
// left for has ended, so no device needs to write that transition.
export function effectiveStatus(entry: RobotStatusEntry | null, matches: ScheduleItem[], now: number): EffectiveStatus {
    if (!entry) return { status: 'inbound', since: null, entry: null, autoInbound: false, match: null };
    const match = entry.match_key ? matches.find((m) => m.match_key === entry.match_key) ?? null : null;
    if (entry.status === 'away' && match && now >= Date.parse(match.end_at)) {
        return { status: 'inbound', since: match.end_at, entry, autoInbound: true, match };
    }
    return { status: entry.status, since: entry.set_at, entry, autoInbound: false, match };
}

type EntryFields = Pick<RobotStatusEntry, 'status'> & Partial<Pick<RobotStatusEntry, 'pending_label' | 'note' | 'run_id' | 'checklist_index' | 'match_key'>>;

function append(eventKey: string, fields: EntryFields, editor: string | null) {
    return saveRecord<RobotStatusEntry>(robotStatusTable, {
        event_key: eventKey,
        status: fields.status,
        pending_label: fields.pending_label ?? null,
        note: fields.note?.trim() || null,
        run_id: fields.run_id ?? null,
        checklist_index: fields.checklist_index ?? null,
        match_key: fields.match_key ?? null,
        set_at: new Date().toISOString(),
        set_by_name: editor,
        updated_by_name: editor
    });
}

export function markInbound(eventKey: string, editor: string | null, note?: string) {
    return append(eventKey, { status: 'inbound', note }, editor);
}

// Starts a new pit run at the first checklist (or straight to Ready when no
// checklists are configured).
export function robotArrived(eventKey: string, sequence: ChecklistSequence, editor: string | null, note?: string) {
    const runId = crypto.randomUUID();
    const first = sequence.checklists[0];
    return first
        ? append(eventKey, { status: 'pending', run_id: runId, checklist_index: 0, pending_label: first.name, note }, editor)
        : append(eventKey, { status: 'ready', run_id: runId, note }, editor);
}

// Moves from the current checklist to the next one, or to Ready after the
// last. Does nothing if someone else already advanced (the newest entry is no
// longer `current`), so two devices finishing at once don't skip a checklist.
export async function advanceChecklist(eventKey: string, current: RobotStatusEntry, sequence: ChecklistSequence, editor: string | null) {
    const [latest] = await listStatusHistory(eventKey);
    if (!latest || latest.id !== current.id) return null;
    const nextIndex = (current.checklist_index ?? 0) + 1;
    const next = sequence.checklists[nextIndex];
    return next
        ? append(eventKey, { status: 'pending', run_id: current.run_id, checklist_index: nextIndex, pending_label: next.name }, editor)
        : append(eventKey, { status: 'ready', run_id: current.run_id }, editor);
}

export function markDeparted(eventKey: string, matchKey: string | null, editor: string | null, note?: string) {
    return append(eventKey, { status: 'away', match_key: matchKey, note }, editor);
}

// Lead/admin override: jump straight to a status. Choosing Pending starts a
// fresh run at the first checklist.
export function setStatusManually(
    eventKey: string,
    status: RobotStatus,
    options: { sequence: ChecklistSequence; matchKey: string | null; note?: string },
    editor: string | null
) {
    switch (status) {
        case 'inbound':
            return markInbound(eventKey, editor, options.note);
        case 'pending':
            return robotArrived(eventKey, options.sequence, editor, options.note);
        case 'away':
            return markDeparted(eventKey, options.matchKey, editor, options.note);
        case 'ready':
            return append(eventKey, { status: 'ready', note: options.note }, editor);
    }
}
