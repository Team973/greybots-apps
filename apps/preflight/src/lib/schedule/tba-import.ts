import { supabase } from '@greybots/common/supabase/client';
import { db, getMeta, setMeta } from '@/lib/db';
import { matchBlockMinutes } from '@/lib/constants';
import { saveRecord } from '@/lib/sync/local-repo';
import { uuidFromName } from '@/lib/uuid';
import { deleteScheduleItem, saveActiveEvent, scheduleTable } from './schedule-repo';
import type { ActiveEvent, MatchInfo, ScheduleItem } from './types';

// Calls the tba-proxy Edge Function (which holds the TBA API key), so an
// import needs internet and a Supabase session: the web user's own, or a
// kiosk's linked account.
const tbaProxyFunction = 'tba-proxy';

interface TbaEvent {
    key: string;
    name: string;
    start_date: string;
    end_date: string;
    timezone: string | null;
}

interface TbaMatch {
    key: string;
    comp_level: string;
    set_number: number;
    match_number: number;
    alliances: { red: { team_keys: string[] }; blue: { team_keys: string[] } };
    time: number | null;
    predicted_time: number | null;
    actual_time: number | null;
}

export interface TeamSchedule {
    event: TbaEvent;
    matches: TbaMatch[];
}

export interface ImportResult {
    added: number;
    updated: number;
    removed: number;
    // Matches TBA knows about but hasn't scheduled a time for yet.
    unscheduled: number;
}

async function describeFunctionError(error: unknown, data: { error?: string } | null): Promise<string> {
    if (data?.error) return data.error;
    const context = (error as { context?: Response })?.context;
    try {
        const body = await context?.json?.();
        if (body?.error) return body.error;
    } catch {
        // Body wasn't JSON; fall through to the generic message.
    }
    return (error as Error)?.message ?? 'Unknown error';
}

export async function fetchTeamSchedule(eventKey: string, teamNumber: number): Promise<TeamSchedule> {
    const { data, error } = await supabase.functions.invoke(tbaProxyFunction, {
        body: { action: 'get_team_schedule', event_id: eventKey, team_number: teamNumber }
    });
    if (error || data?.error) throw new Error(await describeFunctionError(error, data));
    return data as TeamSchedule;
}

function teamNumbers(keys: string[] | undefined): number[] {
    return (keys ?? []).map((k) => Number(k.replace('frc', ''))).filter((n) => Number.isFinite(n));
}

function unixToIso(seconds: number | null): string | null {
    return seconds ? new Date(seconds * 1000).toISOString() : null;
}

export function matchTitle(compLevel: string, setNumber: number, matchNumber: number): string {
    switch (compLevel) {
        case 'qm': return `Qual ${matchNumber}`;
        // Double-elimination playoffs number every match by set.
        case 'sf': return `Playoff ${setNumber}`;
        case 'f': return `Final ${matchNumber}`;
        case 'qf': return `QF ${setNumber}-${matchNumber}`;
        case 'ef': return `EF ${setNumber}-${matchNumber}`;
        default: return `${compLevel.toUpperCase()} ${setNumber}-${matchNumber}`;
    }
}

function toMatchInfo(match: TbaMatch, teamNumber: number): MatchInfo {
    const red = teamNumbers(match.alliances?.red?.team_keys);
    const blue = teamNumbers(match.alliances?.blue?.team_keys);
    return {
        comp_level: match.comp_level,
        set_number: match.set_number,
        match_number: match.match_number,
        alliance: red.includes(teamNumber) ? 'red' : blue.includes(teamNumber) ? 'blue' : null,
        red,
        blue,
        scheduled_time: unixToIso(match.time),
        predicted_time: unixToIso(match.predicted_time),
        actual_time: unixToIso(match.actual_time)
    };
}

function sameInstant(a: string, b: string) {
    return Date.parse(a) === Date.parse(b);
}

function lastImportKey(eventKey: string) {
    return `tba_import:${eventKey}`;
}

export async function getLastImportAt(eventKey: string): Promise<string | null> {
    return (await getMeta<string>(lastImportKey(eventKey))) ?? null;
}

// Pull our team's matches from TBA and create/update/remove the matching
// schedule items. Only rows that actually changed are written, so repeated
// imports don't generate sync traffic. Also refreshes the event's name and
// dates from TBA.
export async function importTbaSchedule(activeEvent: ActiveEvent, editorName: string | null): Promise<ImportResult> {
    const { event, matches } = await fetchTeamSchedule(activeEvent.event_key, activeEvent.team_number);

    const refreshed: ActiveEvent = {
        ...activeEvent,
        name: event.name || activeEvent.name,
        start_date: event.start_date || activeEvent.start_date,
        end_date: event.end_date || activeEvent.end_date,
        timezone: event.timezone ?? activeEvent.timezone
    };
    if (JSON.stringify(refreshed) !== JSON.stringify(activeEvent)) {
        await saveActiveEvent(refreshed, editorName);
    }

    const table = db.syncedTable<ScheduleItem>(scheduleTable);
    const existing = await table.where('event_key').equals(activeEvent.event_key).filter((i) => i.kind === 'match').toArray();
    const existingById = new Map(existing.map((item) => [item.id, item]));
    const seen = new Set<string>();
    const result: ImportResult = { added: 0, updated: 0, removed: 0, unscheduled: 0 };

    for (const match of matches) {
        const info = toMatchInfo(match, activeEvent.team_number);
        const startIso = info.actual_time ?? info.predicted_time ?? info.scheduled_time;
        if (!startIso) {
            result.unscheduled++;
            continue;
        }

        const id = await uuidFromName(`match:${match.key}`);
        seen.add(id);
        const start = new Date(startIso);
        const end = new Date(start.getTime() + matchBlockMinutes * 60_000);
        const title = matchTitle(match.comp_level, match.set_number, match.match_number);
        const current = existingById.get(id);

        const unchanged = current && !current.deleted && current.title === title
            && sameInstant(current.start_at, start.toISOString()) && sameInstant(current.end_at, end.toISOString())
            && JSON.stringify(current.match_info) === JSON.stringify(info);
        if (unchanged) continue;

        await saveRecord<ScheduleItem>(scheduleTable, {
            id,
            event_key: activeEvent.event_key,
            kind: 'match',
            category: 'match',
            title,
            notes: current?.notes ?? null,
            start_at: start.toISOString(),
            end_at: end.toISOString(),
            match_key: match.key,
            match_info: info,
            phase: null,
            updated_by_name: editorName
        });
        if (current && !current.deleted) result.updated++;
        else result.added++;
    }

    // TBA occasionally regenerates a schedule (e.g. playoff tiebreakers);
    // drop matches that no longer exist.
    for (const item of existing) {
        if (!item.deleted && !seen.has(item.id)) {
            await deleteScheduleItem(item.id);
            result.removed++;
        }
    }

    await setMeta(lastImportKey(activeEvent.event_key), new Date().toISOString());
    return result;
}
