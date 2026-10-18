import { supabase } from '@greybots/common/supabase/client';
import { check, unwrap } from './db';
import { addDays, combine, parseDate, toDateString } from './dates';

// Shop sessions, and the plan for each: the tickets to work on.
//
// A repeating schedule is a series, but its sessions are ordinary rows, made
// when the series is: each one can then be moved, renamed, or cancelled on
// its own, like an event in a calendar. Changing "this and following" applies
// to the rest of the series from that session on.
//
// A session's plan starts from the previous session's unfinished tickets the
// first time anyone opens it (workshop_seed_session_plan in the database);
// leads add and remove tickets from there.

export interface Session {
    id: string;
    series_id: string | null;
    title: string;
    starts_at: string;
    ends_at: string;
    notes: string;
    plan_seeded: boolean;
    created_at: string;
}

export interface SessionSeries {
    id: string;
    title: string;
    weekdays: number[];
    start_time: string;
    end_time: string;
    starts_on: string;
    ends_on: string;
}

export interface PlanItem {
    session_id: string;
    ticket_id: string;
    sort_order: number;
    carried_over: boolean;
    added_at: string;
}

// The most sessions one series makes (a year of three-a-week).
const maxSeriesSessions = 160;

export async function fetchSessions(fromIso: string, toIso: string): Promise<Session[]> {
    return unwrap(
        await supabase.from('WorkshopSession').select('*').gte('ends_at', fromIso).lt('starts_at', toIso).order('starts_at')
    ) as Session[];
}

export async function fetchSession(id: string): Promise<Session | null> {
    return unwrap(await supabase.from('WorkshopSession').select('*').eq('id', id).maybeSingle()) as Session | null;
}

// The session happening now, or the next one to start.
export async function fetchNextSession(): Promise<Session | null> {
    return unwrap(
        await supabase.from('WorkshopSession').select('*').gt('ends_at', new Date().toISOString()).order('starts_at').limit(1).maybeSingle()
    ) as Session | null;
}

export async function fetchNeighbors(session: Session): Promise<{ previous: Session | null; next: Session | null }> {
    const [previous, next] = await Promise.all([
        supabase.from('WorkshopSession').select('*').lt('starts_at', session.starts_at).order('starts_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('WorkshopSession').select('*').gt('starts_at', session.starts_at).order('starts_at').limit(1).maybeSingle()
    ]);
    return { previous: unwrap(previous) as Session | null, next: unwrap(next) as Session | null };
}

export async function fetchSeries(id: string): Promise<SessionSeries | null> {
    return unwrap(await supabase.from('WorkshopSessionSeries').select('*').eq('id', id).maybeSingle()) as SessionSeries | null;
}

// --- Creating ---

export async function createSession(session: Pick<Session, 'title' | 'starts_at' | 'ends_at' | 'notes'>): Promise<Session> {
    validateTimes(session.starts_at, session.ends_at);
    return unwrap(await supabase.from('WorkshopSession').insert(session).select().single()) as Session;
}

// The dates a repeating schedule falls on.
export function seriesDates(weekdays: number[], startsOn: string, endsOn: string): string[] {
    const dates: string[] = [];
    for (let day = startsOn; day <= endsOn && dates.length < maxSeriesSessions; day = addDays(day, 1)) {
        if (weekdays.includes(parseDate(day).getDay())) dates.push(day);
    }
    return dates;
}

export async function createSeries(series: Omit<SessionSeries, 'id'>, notes = ''): Promise<number> {
    if (series.weekdays.length === 0) throw new Error('Pick at least one day of the week.');
    if (series.ends_on < series.starts_on) throw new Error('The last day is before the first.');
    if (series.end_time <= series.start_time) throw new Error('Sessions have to end after they start.');
    const dates = seriesDates(series.weekdays, series.starts_on, series.ends_on);
    if (dates.length === 0) throw new Error('None of those days fall between the first and last day.');

    const created = unwrap(await supabase.from('WorkshopSessionSeries').insert(series).select('id').single()) as { id: string };
    const rows = dates.map((day) => ({
        series_id: created.id,
        title: series.title,
        starts_at: combine(day, series.start_time),
        ends_at: combine(day, series.end_time),
        notes
    }));
    check(await supabase.from('WorkshopSession').insert(rows));
    return rows.length;
}

// --- Changing ---

function validateTimes(startsAt: string, endsAt: string) {
    if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error('Sessions have to end after they start.');
}

export async function updateSession(id: string, changes: Partial<Pick<Session, 'title' | 'starts_at' | 'ends_at' | 'notes'>>): Promise<void> {
    if (changes.starts_at && changes.ends_at) validateTimes(changes.starts_at, changes.ends_at);
    check(await supabase.from('WorkshopSession').update(changes).eq('id', id));
}

// Give this session and every later one in its series the same title and
// time of day (each keeps its own date).
export async function updateFollowing(session: Session, changes: { title: string; start_time: string; end_time: string; notes?: string }): Promise<number> {
    if (!session.series_id) throw new Error('This session isn’t part of a series.');
    if (changes.end_time <= changes.start_time) throw new Error('Sessions have to end after they start.');
    const following = unwrap(
        await supabase.from('WorkshopSession').select('id, starts_at').eq('series_id', session.series_id).gte('starts_at', session.starts_at)
    ) as { id: string; starts_at: string }[];
    await Promise.all(
        following.map((s) => {
            const day = toDateString(new Date(s.starts_at));
            const update: Record<string, string> = {
                title: changes.title,
                starts_at: combine(day, changes.start_time),
                ends_at: combine(day, changes.end_time)
            };
            if (changes.notes !== undefined) update.notes = changes.notes;
            return supabase.from('WorkshopSession').update(update).eq('id', s.id).then(check);
        })
    );
    check(
        await supabase
            .from('WorkshopSessionSeries')
            .update({ title: changes.title, start_time: changes.start_time, end_time: changes.end_time })
            .eq('id', session.series_id)
    );
    return following.length;
}

export async function deleteSession(id: string): Promise<void> {
    check(await supabase.from('WorkshopSession').delete().eq('id', id));
}

// Cancel this session and every later one in its series (the series ends the
// day before).
export async function deleteFollowing(session: Session): Promise<void> {
    if (!session.series_id) return deleteSession(session.id);
    check(await supabase.from('WorkshopSession').delete().eq('series_id', session.series_id).gte('starts_at', session.starts_at));
    const dayBefore = addDays(toDateString(new Date(session.starts_at)), -1);
    const series = await fetchSeries(session.series_id);
    if (series && dayBefore >= series.starts_on) {
        check(await supabase.from('WorkshopSessionSeries').update({ ends_on: dayBefore }).eq('id', series.id));
    } else if (series) {
        check(await supabase.from('WorkshopSessionSeries').delete().eq('id', series.id));
    }
}

// --- Plans ---

// Carry the previous session's unfinished tickets over, if that hasn't
// happened yet (`force` does it again, for leads). Returns how many were added.
export async function seedPlan(sessionId: string, force = false): Promise<number> {
    return unwrap(await supabase.rpc('workshop_seed_session_plan', { p_session_id: sessionId, p_force: force })) as number;
}

export async function fetchPlan(sessionId: string): Promise<PlanItem[]> {
    return unwrap(await supabase.from('WorkshopSessionTicket').select('*').eq('session_id', sessionId).order('sort_order')) as PlanItem[];
}

// Every session a set of tickets is planned for, for "in the plan" badges.
export async function fetchPlansFor(sessionIds: string[]): Promise<PlanItem[]> {
    if (sessionIds.length === 0) return [];
    return unwrap(await supabase.from('WorkshopSessionTicket').select('*').in('session_id', sessionIds)) as PlanItem[];
}

export async function addToPlan(sessionId: string, ticketIds: string[], after: number): Promise<void> {
    if (ticketIds.length === 0) return;
    const rows = ticketIds.map((ticket_id, i) => ({ session_id: sessionId, ticket_id, sort_order: after + i + 1 }));
    check(await supabase.from('WorkshopSessionTicket').upsert(rows, { onConflict: 'session_id,ticket_id', ignoreDuplicates: true }));
}

export async function removeFromPlan(sessionId: string, ticketId: string): Promise<void> {
    check(await supabase.from('WorkshopSessionTicket').delete().eq('session_id', sessionId).eq('ticket_id', ticketId));
}

export async function reorderPlan(sessionId: string, ticketIds: string[]): Promise<void> {
    await Promise.all(
        ticketIds.map((ticketId, i) =>
            supabase.from('WorkshopSessionTicket').update({ sort_order: i + 1 }).eq('session_id', sessionId).eq('ticket_id', ticketId).then(check)
        )
    );
}
