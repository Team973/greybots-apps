import { addDays, parseDate, toDateString, today } from './dates';
import type { Ticket } from './tickets';

// Milestone progress, and the burnup chart that helps predict when one will
// be done: how much work is in it (scope) and how much is complete, day by
// day, with a forecast from the recent pace.
//
// Scope only counts tickets that are meant to get done: one closed as a
// duplicate or "won't do" leaves the scope on the day it was closed. The
// history is rebuilt from the tickets in the milestone now, so a ticket moved
// in from another milestone counts from the day it was opened.

export interface MilestoneProgress {
    // Tickets meant to get done (not duplicates or won't-dos).
    scope: number;
    done: number;
    open: number;
    // 0 to 1.
    fraction: number;
}

export function milestoneProgress(tickets: Ticket[]): MilestoneProgress {
    const counted = tickets.filter((t) => t.status !== 'closed' || t.close_reason === 'complete');
    const done = counted.filter((t) => t.status === 'closed').length;
    return { scope: counted.length, done, open: counted.length - done, fraction: counted.length ? done / counted.length : 0 };
}

export interface BurnupPoint {
    date: string;
    scope: number;
    done: number;
}

export interface Burnup {
    points: BurnupPoint[];
    // Completed tickets per day over the recent window, or null with no
    // completions to go on.
    pace: number | null;
    // When the open tickets would be done at that pace (null when there's no
    // pace, or nothing left to do).
    forecast: string | null;
}

// Days of history the pace is taken from.
const paceWindow = 21;

const dayOf = (iso: string) => toDateString(new Date(iso));

export function burnup(tickets: Ticket[], startedAt: string): Burnup {
    const end = today();
    let start = dayOf(startedAt);
    for (const t of tickets) if (dayOf(t.created_at) < start) start = dayOf(t.created_at);
    if (start > end) start = end;

    const points: BurnupPoint[] = [];
    for (let date = start; date <= end; date = addDays(date, 1)) {
        let scope = 0;
        let done = 0;
        for (const t of tickets) {
            if (dayOf(t.created_at) > date) continue;
            const closedBy = t.status === 'closed' && t.closed_at && dayOf(t.closed_at) <= date;
            if (closedBy && t.close_reason !== 'complete') continue;
            scope++;
            if (closedBy) done++;
        }
        points.push({ date, scope, done });
    }

    const last = points[points.length - 1];
    const windowStart = points[Math.max(0, points.length - 1 - paceWindow)];
    const days = Math.round((parseDate(last.date).getTime() - parseDate(windowStart.date).getTime()) / 86_400_000);
    const completed = last.done - windowStart.done;
    const pace = days > 0 && completed > 0 ? completed / days : null;
    const remaining = last.scope - last.done;
    const forecast = pace && remaining > 0 ? addDays(end, Math.ceil(remaining / pace)) : null;
    return { points, pace, forecast };
}
