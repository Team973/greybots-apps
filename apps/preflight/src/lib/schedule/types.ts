import type { SyncedRecord } from '@/lib/sync/types';

// Adding a category also needs the PreflightScheduleItem_category_check
// constraint updated in a migration.
export type ScheduleCategory = 'event' | 'match' | 'practice' | 'pit' | 'programming' | 'admin';

// Display order for filters and pickers.
export const scheduleCategories: ScheduleCategory[] = ['event', 'match', 'practice', 'pit', 'programming', 'admin'];

// Categories a lead/admin can pick for a custom event ('match' is reserved
// for TBA-imported matches).
export const customCategories = scheduleCategories.filter((c) => c !== 'match');

export const categoryLabels: Record<ScheduleCategory, string> = {
    event: 'Event',
    match: 'Matches',
    practice: 'Practice',
    pit: 'Pit',
    programming: 'Programming',
    admin: 'Admin'
};

// Block colors. Matches use their alliance color instead (see matchColor).
export const categoryColors: Record<ScheduleCategory, string> = {
    event: '#6d4fb3',
    match: '#c62828',
    practice: '#2e7d32',
    pit: '#b05703',
    programming: '#ad1457',
    admin: '#52606d'
};

// Schedule page filters: the item categories plus completed tasks, which the
// calendar shows as a read-only layer for post-event review (issue #81).
export type ScheduleFilter = ScheduleCategory | 'task';
export const scheduleFilters: ScheduleFilter[] = [...scheduleCategories, 'task'];
export const taskColor = '#00897b';
export const filterLabels: Record<ScheduleFilter, string> = { ...categoryLabels, task: 'Tasks' };
export const filterColors: Record<ScheduleFilter, string> = { ...categoryColors, task: taskColor };

// "973b " -> "973B". Also accepts the number older saved events hold.
export function normalizeTeam(team: string | number | null | undefined): string {
    return String(team ?? '').trim().toUpperCase();
}

// A team number, optionally followed by one letter.
export function isValidTeam(team: string): boolean {
    return /^[1-9]\d{0,4}[A-Z]?$/.test(normalizeTeam(team));
}

export function matchColor(alliance: 'red' | 'blue' | null | undefined): string {
    return alliance === 'red' ? '#c62828' : alliance === 'blue' ? '#1565c0' : '#616161';
}

export function scheduleItemColor(item: Pick<ScheduleItem, 'kind' | 'category' | 'match_info'>): string {
    return item.kind === 'match' ? matchColor(item.match_info?.alliance) : categoryColors[item.category];
}

export interface MatchInfo {
    comp_level: string;
    set_number: number;
    match_number: number;
    // Our alliance in this match, if we're in it.
    alliance: 'red' | 'blue' | null;
    // Teams as TBA names them: "973", or "973B" for an offseason B team.
    // (Rows imported before lettered teams were supported hold numbers.)
    red: (string | number)[];
    blue: (string | number)[];
    // ISO timestamps from TBA; null when TBA doesn't have them yet.
    scheduled_time: string | null;
    predicted_time: string | null;
    actual_time: string | null;
    // When TBA posted the result, i.e. the match is over. Absent on rows
    // imported before this was tracked.
    result_time?: string | null;
}

export type EstimateSource = 'actual' | 'override' | 'delay' | 'predicted' | 'published';

// Every time a match has (issue #80). See lib/schedule/timing.ts.
export interface MatchTimes {
    published: string | null;
    // Best current guess at the start; equals the actual start once known.
    estimated: string;
    source: EstimateSource;
    actualStart: string | null;
    completed: string | null;
    // Where the completion time came from: TBA posting the result, or the
    // match getting scouting data in GreyScout.
    completedSource: 'tba' | 'scouting' | null;
}

// Timeline groups for milestones (requirements §2.1.1). Adding a phase also
// needs the PreflightScheduleItem_phase_check constraint updated.
export type MilestonePhase = 'prep' | 'competition' | 'elimination' | 'closeout';
export const milestonePhases: MilestonePhase[] = ['prep', 'competition', 'elimination', 'closeout'];
export const phaseLabels: Record<MilestonePhase, string> = {
    prep: 'Event preparation',
    competition: 'Competition day',
    elimination: 'Elimination tournament',
    closeout: 'Event closeout'
};

// 'match': imported from TBA. 'custom': a one-off calendar entry.
// 'milestone': part of the event timeline (issue #79).
export type ScheduleKind = 'match' | 'custom' | 'milestone';

export interface ScheduleItem extends SyncedRecord {
    event_key: string;
    kind: ScheduleKind;
    category: ScheduleCategory;
    title: string;
    notes: string | null;
    start_at: string;
    end_at: string;
    match_key: string | null;
    match_info: MatchInfo | null;
    // Timeline group (milestones only).
    phase?: MilestonePhase | null;
    updated_by_name: string | null;
    // Not stored: filled in by listScheduleItems() for matches, whose
    // start_at/end_at are moved to the estimated time.
    times?: MatchTimes;
}

// The event the schedule is built around. Shared by every device.
export interface ActiveEvent {
    event_key: string;
    // Our team at this event. A string, not a number: offseason events give
    // some teams a letter ("973B"). Always normalized by normalizeTeam().
    team_number: string;
    name: string;
    // Local calendar dates, "YYYY-MM-DD", inclusive.
    start_date: string;
    end_date: string;
    // IANA timezone from TBA, e.g. "America/Los_Angeles".
    timezone: string | null;
}
