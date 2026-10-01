import { getSetting, saveSetting } from '@/lib/settings';
import type { ScoutingCompletion } from './scouting';
import type { EstimateSource, MatchTimes, ScheduleItem } from './types';

// Match timing (issue #80). FRC schedules drift, so every match has up to
// four times: published (TBA `time`), estimated, actual start, and actual
// completion. The estimate comes from, in order:
//   1. a manual override for that match,
//   2. the published time plus the manual "field is running N min behind"
//      delay, when one is set,
//   3. TBA's predicted time,
//   4. the published time.
// A match is complete once TBA posts its result or, failing that, once it
// has scouting data in GreyScout (see ./scouting.ts).
// Overrides and the delay are shared settings, so they work offline and sync
// to every pit device. listScheduleItems() applies them, so the calendar, the
// countdowns, automatic Inbound, and smart steps all follow the estimate.

const timingKey = 'match_timing';
const prepKey = 'match_prep';

export interface MatchTiming {
    // The overrides only apply to this event.
    event_key: string;
    // Positive = running behind, negative = ahead. 0 = follow TBA.
    delay_minutes: number;
    // Match key -> estimated start (ISO).
    overrides: Record<string, string>;
}

// How long before a match the pit needs to act. Configurable.
export interface MatchPrep {
    // Leave the pit for the queue this long before the match.
    queue_minutes: number;
    // Start pre-match prep this long before the match.
    prep_minutes: number;
}

export const defaultMatchPrep: MatchPrep = { queue_minutes: 20, prep_minutes: 45 };

export function emptyTiming(eventKey: string): MatchTiming {
    return { event_key: eventKey, delay_minutes: 0, overrides: {} };
}

export async function getMatchTiming(eventKey: string): Promise<MatchTiming> {
    const saved = await getSetting<MatchTiming>(timingKey);
    return saved && saved.event_key === eventKey ? { ...emptyTiming(eventKey), ...saved } : emptyTiming(eventKey);
}

export function saveMatchTiming(timing: MatchTiming, editorName: string | null) {
    return saveSetting(timingKey, timing, editorName);
}

export async function getMatchPrep(): Promise<MatchPrep> {
    return { ...defaultMatchPrep, ...((await getSetting<MatchPrep>(prepKey)) ?? {}) };
}

export function saveMatchPrep(prep: MatchPrep, editorName: string | null) {
    return saveSetting(prepKey, prep, editorName);
}

// Set (or with null, clear) the estimated start of one match.
export async function setMatchOverride(eventKey: string, matchKey: string, at: string | null, editorName: string | null) {
    const timing = await getMatchTiming(eventKey);
    const overrides = { ...timing.overrides };
    if (at) overrides[matchKey] = new Date(at).toISOString();
    else delete overrides[matchKey];
    await saveMatchTiming({ ...timing, overrides }, editorName);
}

export async function setFieldDelay(eventKey: string, minutes: number, editorName: string | null) {
    const timing = await getMatchTiming(eventKey);
    await saveMatchTiming({ ...timing, delay_minutes: Math.round(minutes) }, editorName);
}

export const estimateSourceLabels: Record<EstimateSource, string> = {
    actual: 'actual start',
    override: 'set by hand',
    delay: 'published + field delay',
    predicted: 'TBA prediction',
    published: 'published time'
};

// `item` must be the stored row (not one already adjusted by applyTiming).
export function matchTimes(item: ScheduleItem, timing: MatchTiming | null, scouted: ScoutingCompletion = {}): MatchTimes {
    const info = item.match_info;
    const published = info?.scheduled_time ?? null;
    const actualStart = info?.actual_time ?? null;
    // GreyScout scouts qualification matches, identified by match number.
    const scoutedAt = info?.comp_level === 'qm' ? scouted[String(info.match_number)] ?? null : null;
    const completed = info?.result_time ?? scoutedAt;
    const completedSource = info?.result_time ? ('tba' as const) : scoutedAt ? ('scouting' as const) : null;
    const base = { published, actualStart, completed, completedSource };

    if (actualStart) return { ...base, estimated: actualStart, source: 'actual' };
    const override = item.match_key ? timing?.overrides[item.match_key] : undefined;
    if (override) return { ...base, estimated: override, source: 'override' };
    if (timing?.delay_minutes && published) {
        const estimated = new Date(Date.parse(published) + timing.delay_minutes * 60_000).toISOString();
        return { ...base, estimated, source: 'delay' };
    }
    if (info?.predicted_time) return { ...base, estimated: info.predicted_time, source: 'predicted' };
    return { ...base, estimated: published ?? item.start_at, source: 'published' };
}

// Moves each match's block to its estimated start, keeping its length, and
// attaches all of its times.
export function applyTiming(items: ScheduleItem[], timing: MatchTiming | null, scouted: ScoutingCompletion = {}): ScheduleItem[] {
    return items.map((item) => {
        if (item.kind !== 'match') return item;
        const times = matchTimes(item, timing, scouted);
        const length = Date.parse(item.end_at) - Date.parse(item.start_at);
        const start = Date.parse(times.estimated);
        return {
            ...item,
            start_at: new Date(start).toISOString(),
            end_at: new Date(start + length).toISOString(),
            times
        };
    });
}

export interface MatchDeadlines {
    start: number;
    queueAt: number;
    prepAt: number;
}

// When the pit needs to start prep and leave for the queue, from the match's
// (estimated) start. Recomputed whenever the estimate or the prep timing
// changes.
export function matchDeadlines(match: ScheduleItem, prep: MatchPrep): MatchDeadlines {
    const start = Date.parse(match.start_at);
    return { start, queueAt: start - prep.queue_minutes * 60_000, prepAt: start - prep.prep_minutes * 60_000 };
}
