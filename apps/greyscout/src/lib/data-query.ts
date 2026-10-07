// TODO: fix types
// @ts-nocheck


import { supabase } from "@greybots/common/supabase/client";
import { matchScoutTable, matchScheduleTable, teamInfoTable, teamNumberColumn, pitScoutTable, preScoutTable, eventInfoTable } from "@/lib/constants";

// Qualification matches are the only ones with a schedule known ahead of
// time (playoff pairings are only decided live), so schedule-based
// auto-fill only ever looks up "qm" matches.
const QUALIFICATION_COMP_LEVEL = "qm";

// Look up the six teams (red1-3, blue1-3) assigned to a qualification match,
// or null if the schedule hasn't been synced / the match doesn't exist yet.
export async function queryMatchTeams(eventId, matchNumber) {
    const { data, error } = await supabase.from(matchScheduleTable).select()
        .eq('event_id', eventId)
        .eq('comp_level', QUALIFICATION_COMP_LEVEL)
        .eq('match_number', matchNumber)
        .limit(1);

    if (error) {
        console.log(error);
        return null;
    }

    return data.length > 0 ? data[0] : null;
}

// The teams in the Nth playoff match of an event (1 = the first playoff
// match, counting through the bracket and then the finals), or null if the
// playoff schedule hasn't been synced that far. Playoff match numbers on
// the scouting form are this running count (issue #123).
export async function queryPlayoffMatchTeams(eventId, playoffNumber) {
    const schedule = await queryEventMatchSchedule(eventId);
    const playoffs = schedule.filter((match) => match.comp_level !== QUALIFICATION_COMP_LEVEL);
    return playoffs[playoffNumber - 1] ?? null;
}

// Ordering for comp levels within a schedule: qualifications first, then
// playoffs in bracket order.
const COMP_LEVEL_RANK = { qm: 0, ef: 1, qf: 2, sf: 3, f: 4 };

// The full match schedule for an event (all comp levels), ordered the way a
// scout would expect to see it play out.
export async function queryEventMatchSchedule(eventId) {
    const { data, error } = await supabase.from(matchScheduleTable).select().eq('event_id', eventId);

    if (error) {
        console.log(error);
        return [];
    }

    return data.sort((a, b) => {
        const rankDiff = (COMP_LEVEL_RANK[a.comp_level] ?? 99) - (COMP_LEVEL_RANK[b.comp_level] ?? 99);
        if (rankDiff !== 0) return rankDiff;
        if (a.set_number !== b.set_number) return a.set_number - b.set_number;
        return a.match_number - b.match_number;
    });
}

export async function queryTeamNumbers(eventId) {
    const { data, error } = await supabase.from(teamInfoTable).select().eq('event_id', eventId);

    if (error) {
        console.log(error);
        return [];
    }

    return data;
}

export async function queryTeamMatchData(teamNumber, eventId) {
    const { data, error } = await supabase.from(matchScoutTable).select().eq('event', eventId).eq(teamNumberColumn, teamNumber);

    if (error) {
        console.log(error);
        return [];
    }

    return data;
}

export async function queryEventData(eventId) {
    const { data, error } = await supabase.from(matchScoutTable).select().eq('event', eventId);

    if (error) {
        console.log(error);
        return [];
    }

    return data;
}

// All events, newest first — used to label assignments from past events by
// name and sort them.
export async function queryAllEvents() {
    const { data, error } = await supabase.from(eventInfoTable).select('event_id, name, start_date').order('start_date', { ascending: false });

    if (error) {
        console.log(error);
        return [];
    }

    return data;
}

export async function queryEventPitData(eventId) {
    const { data, error } = await supabase.from(pitScoutTable).select('id, pit_team_number, created_at').eq('event', eventId);

    if (error) {
        console.log(error);
        return [];
    }

    return data;
}

export async function queryEventPrescoutData(eventId) {
    const { data, error } = await supabase.from(preScoutTable).select('id, prescout_team_number, created_at').eq('event', eventId);

    if (error) {
        console.log(error);
        return [];
    }

    return data;
}

