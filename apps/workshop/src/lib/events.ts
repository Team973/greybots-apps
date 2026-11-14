import { supabase } from '@greybots/common/supabase/client';
import { unwrap } from './db';
import { addDays, combine, parseDate, toDateString, today } from './dates';
import { fetchSessions, type Session } from './sessions';

// The team's competition events. They come from GreyScout's Event table,
// which its nightly data job fills from The Blue Alliance with the events
// team 973 is registered for (this year's and next year's), so there's
// nothing to keep up by hand here. Workshop only reads them: to count the
// shop sessions left before the next one, and to show them on the schedule.

export interface TeamEvent {
    event_id: string;
    name: string;
    // "YYYY-MM-DD", the event's own days (inclusive).
    start_date: string;
    end_date: string;
}

export const eventName = (e: TeamEvent) => e.name || e.event_id;

// Events overlapping [from, to) ("YYYY-MM-DD").
export async function fetchEvents(from: string, to: string): Promise<TeamEvent[]> {
    return unwrap(
        await supabase.from('Event').select('event_id, name, start_date, end_date').lt('start_date', to).gte('end_date', from).order('start_date')
    ) as TeamEvent[];
}

// The next event that hasn't finished yet (one under way counts).
export async function fetchNextEvent(): Promise<TeamEvent | null> {
    return unwrap(
        await supabase.from('Event').select('event_id, name, start_date, end_date').gte('end_date', today()).order('start_date').limit(1).maybeSingle()
    ) as TeamEvent | null;
}

export interface Countdown {
    event: TeamEvent;
    // Shop sessions that haven't finished and start before the event does.
    sessionsLeft: number;
    daysLeft: number;
    underway: boolean;
    // The schedule stops more than a week before the event (or has nothing
    // in it), so the count is probably short. `lastSession` is when it stops.
    scheduleShort: boolean;
    lastSession: string | null;
}

// How many shop sessions are left before the next event.
export async function fetchCountdown(): Promise<Countdown | null> {
    const event = await fetchNextEvent();
    if (!event) return null;
    const now = new Date();
    const eventStart = combine(event.start_date, '00:00');
    const underway = event.start_date <= today();
    const sessions: Session[] = underway ? [] : await fetchSessions(now.toISOString(), eventStart);
    const daysLeft = Math.max(0, Math.round((parseDate(event.start_date).getTime() - parseDate(today()).getTime()) / 86_400_000));

    const lastSession = sessions.length ? sessions[sessions.length - 1].starts_at : null;
    const scheduleShort = !underway && (!lastSession || addDays(toDateString(new Date(lastSession)), 7) < event.start_date);
    return { event, sessionsLeft: sessions.length, daysLeft, underway, scheduleShort, lastSession };
}
