import { db } from '@/lib/db';
import { saveRecord } from '@/lib/sync/local-repo';
import type { SyncedRecord } from '@/lib/sync/types';

export const robotStatusTable = 'robotStatus';

// Robot readiness (issue #84). Set by hand for now; deriving it from
// checklists (#82) and match timing (#80) comes later.
export type RobotStatus = 'in_pit' | 'pending' | 'ready' | 'away';

export const robotStatuses: RobotStatus[] = ['in_pit', 'pending', 'ready', 'away'];

export const robotStatusLabels: Record<RobotStatus, string> = {
    in_pit: 'In Pit',
    pending: 'Pending',
    ready: 'Robot Ready',
    away: 'Away'
};

// Background and text colors for the big status card (mockup: pending = yellow).
export const robotStatusColors: Record<RobotStatus, { bg: string; fg: string }> = {
    in_pit: { bg: '#455a64', fg: '#ffffff' },
    pending: { bg: '#ffc107', fg: '#1a1a1a' },
    ready: { bg: '#2e7d32', fg: '#ffffff' },
    away: { bg: '#1565c0', fg: '#ffffff' }
};

export const pendingLabelPresets = ['Prematch Checklist', 'Postmatch Checklist', 'Start-of-Day Checklist', 'Repair'];

// One entry in the append-only status log. The newest entry is the current
// status, so devices never overwrite each other and history comes for free.
export interface RobotStatusEntry extends SyncedRecord {
    event_key: string;
    status: RobotStatus;
    pending_label: string | null;
    note: string | null;
    set_at: string;
    set_by_name: string | null;
    updated_by_name: string | null;
}

// Newest first.
export async function listStatusHistory(eventKey: string): Promise<RobotStatusEntry[]> {
    const entries = await db
        .syncedTable<RobotStatusEntry>(robotStatusTable)
        .where('event_key')
        .equals(eventKey)
        .filter((e) => !e.deleted)
        .toArray();
    return entries.sort((a, b) => Date.parse(b.set_at) - Date.parse(a.set_at));
}

// With no entries yet, the robot is assumed to be in the pit.
export function statusText(entry: Pick<RobotStatusEntry, 'status' | 'pending_label'> | null): string {
    if (!entry) return robotStatusLabels.in_pit;
    if (entry.status === 'pending' && entry.pending_label) return `Pending ${entry.pending_label}`;
    return robotStatusLabels[entry.status];
}

export function setRobotStatus(
    eventKey: string,
    status: RobotStatus,
    pendingLabel: string | null,
    note: string | null,
    editor: string | null
) {
    return saveRecord<RobotStatusEntry>(robotStatusTable, {
        event_key: eventKey,
        status,
        pending_label: status === 'pending' ? pendingLabel?.trim() || null : null,
        note: note?.trim() || null,
        set_at: new Date().toISOString(),
        set_by_name: editor,
        updated_by_name: editor
    });
}
