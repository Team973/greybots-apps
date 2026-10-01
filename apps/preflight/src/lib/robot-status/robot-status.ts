import { clockNow } from '@greybots/common/lib/now';
import { db } from '@/lib/db';
import {
    endOfDayChecklistId,
    flowChecklistIds,
    practiceChecklistId,
    prematchIndex,
    startOfDayChecklistId,
    type ChecklistDef,
    type ChecklistSequence,
    type FlowChecklistId
} from '@/lib/checklists/config';
import type { ScheduleItem } from '@/lib/schedule/types';
import { saveRecord } from '@/lib/sync/local-repo';
import type { SyncedRecord } from '@/lib/sync/types';

export const robotStatusTable = 'robotStatus';

// The pit flow (issues #82, #84, #86):
//   Inbound (match over) -> Robot arrived -> Pending checklist 1..N
//   -> Robot Ready -> Robot departed -> Away -> (match ends) -> Inbound
// From any checklist, "Repairs" switches to Repair in progress, which then
// resumes that checklist or jumps to the pre-match checklist.
// Once the post-match checklists are clear, the pit can take a side trip:
//   Practice field checklist (Pending) -> At practice field -> pre-match
// The day is closed and opened with checklists of their own:
//   End of day checklist (Pending) -> Day ended
//   -> Start day -> Start of day checklist (Pending) -> pre-match
// And the pit can pause while the robot isn't ready:
//   On break -> back to exactly where it was
export type RobotStatus = 'inbound' | 'pending' | 'repair' | 'ready' | 'away' | 'practice' | 'break' | 'day_ended';

export const robotStatuses: RobotStatus[] = ['inbound', 'pending', 'repair', 'ready', 'away', 'practice', 'break', 'day_ended'];

export const robotStatusLabels: Record<RobotStatus, string> = {
    inbound: 'Inbound',
    pending: 'Pending',
    repair: 'Repair in progress',
    ready: 'Robot Ready',
    away: 'Away',
    practice: 'At practice field',
    break: 'On break',
    day_ended: 'Day ended'
};

// Background and text colors (mockup: pending = yellow).
export const robotStatusColors: Record<RobotStatus, { bg: string; fg: string }> = {
    inbound: { bg: '#6d4fb3', fg: '#ffffff' },
    pending: { bg: '#ffc107', fg: '#1a1a1a' },
    repair: { bg: '#c62828', fg: '#ffffff' },
    ready: { bg: '#2e7d32', fg: '#ffffff' },
    away: { bg: '#1565c0', fg: '#ffffff' },
    practice: { bg: '#00838f', fg: '#ffffff' },
    break: { bg: '#546e7a', fg: '#ffffff' },
    day_ended: { bg: '#263238', fg: '#ffffff' }
};

// One entry in the append-only status log. The newest entry is the current
// status, so devices never overwrite each other and history comes for free.
export interface RobotStatusEntry extends SyncedRecord {
    event_key: string;
    status: RobotStatus;
    // The active checklist's name (status 'pending'), or the checklist repairs
    // interrupted (status 'repair'), for display/history.
    pending_label: string | null;
    note: string | null;
    set_at: string;
    set_by_name: string | null;
    // The pit visit this entry belongs to (from arrival onward).
    run_id: string | null;
    // Active checklist in the sequence (status 'pending'), or the one repairs
    // interrupted (status 'repair'), 0-based.
    checklist_index: number | null;
    // For a 'pending' entry outside the sequence: which checklist is being
    // run ('practice', 'start_of_day', 'end_of_day'). Absent on rows from
    // before this existed.
    checklist_id?: string | null;
    // The match the robot left for (status 'away').
    match_key: string | null;
    updated_by_name: string | null;
}

// Rows written before 'in_pit' was renamed may still be on a device until it
// pulls the migrated rows.
function normalize(entry: RobotStatusEntry): RobotStatusEntry {
    return (entry.status as string) === 'in_pit' ? { ...entry, status: 'inbound' } : entry;
}

// Newest first, by when each entry was actually written (updated_at, which
// never changes for these append-only rows). Not by set_at: that's the time
// shown to people, and testing mode or a device's drifting clock can make a
// newer entry's set_at look older than the one before it.
export async function listStatusHistory(eventKey: string): Promise<RobotStatusEntry[]> {
    const entries = await db
        .syncedTable<RobotStatusEntry>(robotStatusTable)
        .where('event_key')
        .equals(eventKey)
        .filter((e) => !e.deleted)
        .toArray();
    return entries
        .map(normalize)
        .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || Date.parse(b.set_at) - Date.parse(a.set_at));
}

export function statusText(entry: Pick<RobotStatusEntry, 'status' | 'pending_label'> | null): string {
    if (!entry) return robotStatusLabels.inbound;
    if (entry.status === 'pending' && entry.pending_label) return `Pending ${entry.pending_label}`;
    if (entry.status === 'repair' && entry.pending_label) return `Repair in progress (from ${entry.pending_label})`;
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
// left for has ended (its block is over, or it's known to be complete from
// TBA or scouting data), so no device needs to write that transition.
export function effectiveStatus(entry: RobotStatusEntry | null, matches: ScheduleItem[], now: number): EffectiveStatus {
    if (!entry) return { status: 'inbound', since: null, entry: null, autoInbound: false, match: null };
    const match = entry.match_key ? matches.find((m) => m.match_key === entry.match_key) ?? null : null;
    if (entry.status === 'away' && match) {
        const blockOver = now >= Date.parse(match.end_at);
        // A completion time only counts once the app clock has reached it. In
        // testing mode the clock can be set before a match that has long since
        // been played and scouted; that match isn't over yet on that clock.
        const recorded = match.times?.completed ?? null;
        const completed = recorded && Date.parse(recorded) <= now ? recorded : null;
        if (blockOver || completed) {
            // Whichever said so first.
            const since = completed && (!blockOver || Date.parse(completed) < Date.parse(match.end_at)) ? completed : match.end_at;
            return { status: 'inbound', since, entry, autoInbound: true, match };
        }
    }
    return { status: entry.status, since: entry.set_at, entry, autoInbound: false, match };
}

type EntryFields = Pick<RobotStatusEntry, 'status'> &
    Partial<Pick<RobotStatusEntry, 'pending_label' | 'note' | 'run_id' | 'checklist_index' | 'checklist_id' | 'match_key'>>;

function append(eventKey: string, fields: EntryFields, editor: string | null) {
    return saveRecord<RobotStatusEntry>(robotStatusTable, {
        event_key: eventKey,
        status: fields.status,
        pending_label: fields.pending_label ?? null,
        note: fields.note?.trim() || null,
        run_id: fields.run_id ?? null,
        checklist_index: fields.checklist_index ?? null,
        checklist_id: fields.checklist_id ?? null,
        match_key: fields.match_key ?? null,
        set_at: new Date(clockNow()).toISOString(),
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

// From a checklist: stop for repairs, remembering where we were.
export function startRepair(eventKey: string, current: RobotStatusEntry, editor: string | null, note?: string) {
    return append(
        eventKey,
        { status: 'repair', run_id: current.run_id, checklist_index: current.checklist_index, pending_label: current.pending_label, note },
        editor
    );
}

// After repairs: resume a checklist in the same run (its checked steps are
// kept). Pass the interrupted checklist's index, or the pre-match index.
export function resumeChecklist(eventKey: string, repair: RobotStatusEntry, index: number, sequence: ChecklistSequence, editor: string | null) {
    const checklist = sequence.checklists[index];
    if (!checklist) return append(eventKey, { status: 'ready', run_id: repair.run_id }, editor);
    return append(eventKey, { status: 'pending', run_id: repair.run_id ?? crypto.randomUUID(), checklist_index: index, pending_label: checklist.name }, editor);
}

// --- Checklists outside the sequence ----------------------------------------

// Which flow checklist (practice field, start of day, end of day) the pit is
// on, or null when it's on the standard sequence or not on a checklist.
export function flowChecklistOf(entry: RobotStatusEntry | null): FlowChecklistId | null {
    if (entry?.status !== 'pending' || !entry.checklist_id) return null;
    return flowChecklistIds.find((id) => id === entry.checklist_id) ?? null;
}

function startFlowChecklist(eventKey: string, id: FlowChecklistId, checklist: ChecklistDef, editor: string | null) {
    // Its own run, so its steps start unchecked every time.
    return append(eventKey, { status: 'pending', run_id: crypto.randomUUID(), checklist_id: id, pending_label: checklist.name }, editor);
}

// The newest entry is still `current`: nobody else moved the pit on meanwhile.
async function isStillCurrent(eventKey: string, current: RobotStatusEntry): Promise<boolean> {
    const [latest] = await listStatusHistory(eventKey);
    return !!latest && latest.id === current.id;
}

// Go back to the state the pit was in before `current` (a break, or an end
// of day checklist that was called off): the same status, run, and checklist,
// so checked steps are still checked. With nothing before it, the robot is
// simply Inbound.
export async function resumePrevious(eventKey: string, current: RobotStatusEntry, editor: string | null) {
    const history = await listStatusHistory(eventKey);
    if (history[0]?.id !== current.id) return null;
    const previous = history[1];
    if (!previous) return markInbound(eventKey, editor);
    return append(
        eventKey,
        {
            status: previous.status,
            run_id: previous.run_id,
            checklist_index: previous.checklist_index,
            checklist_id: previous.checklist_id,
            pending_label: previous.pending_label,
            match_key: previous.match_key
        },
        editor
    );
}

// --- Practice field ---------------------------------------------------------

// True while the pit is on the practice field checklist.
export function isPracticeChecklist(entry: RobotStatusEntry | null): boolean {
    return flowChecklistOf(entry) === practiceChecklistId;
}

// The practice field is only on offer once the robot is clear of post-match:
// on the pre-match checklist (or a later one), or Ready. Never during
// post-match checklists or repairs, and not while it's already under way.
export function canGoToPractice(entry: RobotStatusEntry | null, status: RobotStatus, sequence: ChecklistSequence): boolean {
    if (status === 'ready') return true;
    // Not from another flow checklist either (start or end of day).
    if (status !== 'pending' || !entry || flowChecklistOf(entry)) return false;
    return (entry.checklist_index ?? 0) >= prematchIndex(sequence);
}

export function startPracticeChecklist(eventKey: string, checklist: ChecklistDef, editor: string | null) {
    return startFlowChecklist(eventKey, practiceChecklistId, checklist, editor);
}

// The practice field checklist is done: the robot leaves for the practice
// field. Does nothing if another device already moved on.
export async function departForPractice(eventKey: string, current: RobotStatusEntry, editor: string | null) {
    if (!(await isStillCurrent(eventKey, current))) return null;
    return append(eventKey, { status: 'practice', run_id: current.run_id }, editor);
}

// Back from the practice field (or not going after all), or the start of day
// checklist is done: on to the pre-match checklist, in a new run so it starts
// from the top. Anything checked on
// pre-match before the trip doesn't count: the robot has been driven since.
export function returnFromPractice(eventKey: string, sequence: ChecklistSequence, editor: string | null) {
    const index = prematchIndex(sequence);
    const checklist = sequence.checklists[index];
    const runId = crypto.randomUUID();
    return checklist
        ? append(eventKey, { status: 'pending', run_id: runId, checklist_index: index, pending_label: checklist.name }, editor)
        : append(eventKey, { status: 'ready', run_id: runId }, editor);
}

// --- Ending and starting the day --------------------------------------------

// The day can be ended whenever the pit isn't already closing or closed, on a
// break, or with the robot away.
export function canEndDay(entry: RobotStatusEntry | null, status: RobotStatus): boolean {
    if (['day_ended', 'break', 'away', 'practice'].includes(status)) return false;
    return flowChecklistOf(entry) !== endOfDayChecklistId;
}

// "End day": run the end of day checklist, after which the day is ended. With
// no steps to run, the day ends at once.
export function startEndOfDay(eventKey: string, checklist: ChecklistDef, editor: string | null) {
    return checklist.steps.length
        ? startFlowChecklist(eventKey, endOfDayChecklistId, checklist, editor)
        : append(eventKey, { status: 'day_ended' }, editor);
}

// The end of day checklist is done: the day is ended. Nothing is timed from
// here until the day is started again.
export async function endDay(eventKey: string, current: RobotStatusEntry, editor: string | null) {
    if (!(await isStillCurrent(eventKey, current))) return null;
    return append(eventKey, { status: 'day_ended', run_id: current.run_id }, editor);
}

// "Start day": run the start of day checklist, then go on to pre-match.
export function startDay(eventKey: string, checklist: ChecklistDef, sequence: ChecklistSequence, editor: string | null) {
    return checklist.steps.length ? startFlowChecklist(eventKey, startOfDayChecklistId, checklist, editor) : returnFromPractice(eventKey, sequence, editor);
}

// --- Break ------------------------------------------------------------------

// A break is for when the pit stops while the robot isn't ready: part-way
// through a checklist, or in repairs.
export function canTakeBreak(status: RobotStatus): boolean {
    return status === 'pending' || status === 'repair';
}

// Pause. The entry keeps the interrupted state's checklist for display;
// ending the break restores that state exactly (see resumePrevious).
export function startBreak(eventKey: string, current: RobotStatusEntry, editor: string | null) {
    return append(
        eventKey,
        {
            status: 'break',
            run_id: current.run_id,
            checklist_index: current.checklist_index,
            checklist_id: current.checklist_id,
            pending_label: current.pending_label
        },
        editor
    );
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
        case 'repair':
            return append(eventKey, { status: 'repair', note: options.note }, editor);
        case 'ready':
            return append(eventKey, { status: 'ready', note: options.note }, editor);
        case 'practice':
        case 'break':
        case 'day_ended':
            return append(eventKey, { status, note: options.note }, editor);
    }
}
