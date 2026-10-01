import { db } from '@/lib/db';
import { patchRecord, saveRecord } from '@/lib/sync/local-repo';
import { uuidFromName } from '@/lib/uuid';
import { addDays, parseLocalDate } from './dates';
import { scheduleTable } from './schedule-repo';
import { milestonePhases, type ActiveEvent, type MilestonePhase, type ScheduleCategory, type ScheduleItem } from './types';

// The event timeline (issue #79): milestones covering the whole event, not
// just matches. A milestone is a schedule item of kind 'milestone', so it
// shows on the calendar, follows the category filters, and syncs like any
// other item. Leads/admins add the defaults below to an event and then
// rename, move, or delete them freely.

interface MilestoneTemplate {
    // Stable key: the milestone's id is derived from it, so two devices
    // adding the defaults converge on the same rows.
    key: string;
    name: string;
    phase: MilestonePhase;
    category: ScheduleCategory;
    // Event day: 0 = first, 1 = second, -1 = last. Clamped to the event's
    // dates, so a one-day event gets everything on that day.
    day: number;
    // Planned local start ("HH:MM") and length. Starting points only; the
    // real times get set per event.
    start: string;
    minutes: number;
}

const t = (
    key: string,
    name: string,
    phase: MilestonePhase,
    category: ScheduleCategory,
    day: number,
    start: string,
    minutes: number
): MilestoneTemplate => ({ key, name, phase, category, day, start, minutes });

// The standard milestones from the requirements doc (§2.1.1). "Alliance
// selection" is listed there under both competition day and eliminations; it
// appears once here, opening the elimination tournament.
export const milestoneTemplate: MilestoneTemplate[] = [
    t('load_in', 'Team arrival / pit load-in', 'prep', 'pit', 0, '08:00', 60),
    t('pit_setup', 'Pit setup', 'prep', 'pit', 0, '09:00', 90),
    t('robot_mods', 'Robot modifications', 'prep', 'pit', 0, '10:30', 60),
    t('power_on', 'Robot power-on / initial systems check', 'prep', 'pit', 0, '11:30', 30),
    t('radio_setup', 'Radio / network setup', 'prep', 'programming', 0, '12:00', 30),
    t('inspection_prep', 'Inspection preparation', 'prep', 'pit', 0, '13:00', 30),
    t('inspection', 'Robot inspection', 'prep', 'event', 0, '13:30', 45),
    t('field_calibration', 'Field calibration', 'prep', 'programming', 0, '14:30', 30),
    t('practice_field', 'Practice field opening', 'prep', 'practice', 0, '15:00', 30),
    t('practice_schedule', 'Practice schedule', 'prep', 'practice', 0, '15:30', 120),

    t('leave_hotel', 'Leaving hotel for event', 'competition', 'admin', 1, '07:00', 30),
    t('pit_opening', 'Pit opening', 'competition', 'event', 1, '08:00', 15),
    t('driver_meeting', 'Driver meeting', 'competition', 'event', 1, '08:15', 15),
    t('practice_matches', 'Practice matches', 'competition', 'practice', 1, '08:30', 30),
    t('opening_ceremonies', 'Opening ceremonies', 'competition', 'event', 1, '09:00', 30),
    t('quals', 'Qualification matches', 'competition', 'match', 1, '09:30', 150),
    t('lunch', 'Lunch / scheduled event break', 'competition', 'event', 1, '12:00', 60),
    t('leave_event', 'Leaving event for hotel', 'competition', 'admin', 1, '18:00', 30),
    t('dinner', 'Dinner', 'competition', 'admin', 1, '19:00', 60),
    t('team_meeting', 'Hotel general meeting / pit meeting', 'competition', 'admin', 1, '20:30', 30),
    t('quals_complete', 'Qualification matches complete', 'competition', 'match', -1, '12:00', 15),
    t('reinspection', 'Reinspection after qualification matches', 'competition', 'pit', -1, '12:15', 30),

    t('alliance_selection', 'Alliance selection', 'elimination', 'event', -1, '12:45', 30),
    t('elims', 'Elimination rounds', 'elimination', 'match', -1, '13:30', 150),
    t('awards', 'Event awards', 'elimination', 'event', -1, '16:00', 30),
    t('closing_ceremonies', 'Closing ceremonies', 'elimination', 'event', -1, '16:30', 30),

    t('teardown', 'Pit teardown', 'closeout', 'pit', -1, '17:00', 45),
    t('load_out', 'Pit load-out', 'closeout', 'pit', -1, '17:45', 45),
    t('departure', 'Departure', 'closeout', 'admin', -1, '18:30', 15)
];

function templateId(eventKey: string, key: string) {
    return uuidFromName(`milestone:${eventKey}:${key}`);
}

function eventDayCount(event: ActiveEvent): number {
    const ms = parseLocalDate(event.end_date).getTime() - parseLocalDate(event.start_date).getTime();
    return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

// The planned local start of a template milestone at this event.
function templateStart(event: ActiveEvent, template: MilestoneTemplate): Date {
    const days = eventDayCount(event);
    const index = template.day < 0 ? days - 1 : Math.min(template.day, days - 1);
    const [hours, minutes] = template.start.split(':').map(Number);
    const date = parseLocalDate(addDays(event.start_date, index));
    date.setHours(hours, minutes, 0, 0);
    return date;
}

export function isMilestone(item: ScheduleItem): boolean {
    return item.kind === 'milestone';
}

// Milestones in timeline order.
export function sortMilestones(items: ScheduleItem[]): ScheduleItem[] {
    return items
        .filter(isMilestone)
        .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at) || a.title.localeCompare(b.title));
}

// Ids of the event's default milestones. (Hashed, so async: compute these
// outside a live query, which must only await database calls.)
export function defaultMilestoneIds(eventKey: string): Promise<string[]> {
    return Promise.all(milestoneTemplate.map((template) => templateId(eventKey, template.key)));
}

// Add every default milestone the event doesn't have. Existing ones (which
// may have been renamed or moved) are left alone.
export async function addDefaultMilestones(event: ActiveEvent, editorName: string | null): Promise<number> {
    const table = db.syncedTable<ScheduleItem>(scheduleTable);
    let added = 0;
    for (const template of milestoneTemplate) {
        const id = await templateId(event.event_key, template.key);
        const existing = await table.get(id);
        if (existing && !existing.deleted) continue;
        const start = templateStart(event, template);
        await saveRecord<ScheduleItem>(scheduleTable, {
            id,
            event_key: event.event_key,
            kind: 'milestone',
            category: template.category,
            title: template.name,
            notes: null,
            start_at: start.toISOString(),
            end_at: new Date(start.getTime() + template.minutes * 60_000).toISOString(),
            match_key: null,
            match_info: null,
            phase: template.phase,
            updated_by_name: editorName
        });
        added++;
    }
    return added;
}

// Reorder: two neighbors on the timeline trade start times, each keeping its
// own length. If they overlapped, the one moving down starts when the other
// now ends, so the new order holds.
export async function swapMilestones(earlier: ScheduleItem, later: ScheduleItem, editorName: string | null) {
    const start = Math.min(Date.parse(earlier.start_at), Date.parse(later.start_at));
    const laterLength = Date.parse(later.end_at) - Date.parse(later.start_at);
    const earlierLength = Date.parse(earlier.end_at) - Date.parse(earlier.start_at);
    const movedDownStart = Math.max(start + laterLength, Date.parse(later.start_at));
    await patchRecord<ScheduleItem>(scheduleTable, later.id, {
        start_at: new Date(start).toISOString(),
        end_at: new Date(start + laterLength).toISOString(),
        updated_by_name: editorName
    });
    await patchRecord<ScheduleItem>(scheduleTable, earlier.id, {
        start_at: new Date(movedDownStart).toISOString(),
        end_at: new Date(movedDownStart + earlierLength).toISOString(),
        updated_by_name: editorName
    });
}

export type MilestoneState = 'past' | 'current' | 'upcoming';

export function milestoneState(item: ScheduleItem, now: number): MilestoneState {
    if (now >= Date.parse(item.end_at)) return 'past';
    return now >= Date.parse(item.start_at) ? 'current' : 'upcoming';
}

// The phase the event is in right now: that of the milestone in progress,
// else the most recent one that started. Null before the first milestone.
export function currentPhase(items: ScheduleItem[], now: number): MilestonePhase | null {
    const started = sortMilestones(items).filter((m) => m.phase && Date.parse(m.start_at) <= now);
    const inProgress = started.filter((m) => Date.parse(m.end_at) > now);
    const pick = inProgress[inProgress.length - 1] ?? started[started.length - 1];
    return pick?.phase ?? null;
}

// Milestones grouped by phase, in phase order. Ones without a phase come last.
export function groupByPhase(items: ScheduleItem[]): { phase: MilestonePhase | null; milestones: ScheduleItem[] }[] {
    const sorted = sortMilestones(items);
    const groups: { phase: MilestonePhase | null; milestones: ScheduleItem[] }[] = milestonePhases.map((phase) => ({
        phase,
        milestones: sorted.filter((m) => m.phase === phase)
    }));
    const other = sorted.filter((m) => !m.phase || !milestonePhases.includes(m.phase));
    if (other.length) groups.push({ phase: null, milestones: other });
    return groups.filter((g) => g.milestones.length);
}
