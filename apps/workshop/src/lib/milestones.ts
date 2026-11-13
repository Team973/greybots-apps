import { addDays, parseDate, toDateString, today } from './dates';
import type { Session } from './sessions';
import type { Ticket } from './tickets';

// Milestone progress, and the burnup chart that helps predict when a set of
// tickets (a milestone's, or a dashboard chart's) will be done: how much work
// is in it (scope) and how much is complete, day by day, with forecasts of
// when the two lines meet.
//
// Scope only counts tickets that are meant to get done: one closed as a
// duplicate or "won't do" leaves the scope on the day it was closed. The
// history is rebuilt from the tickets in the milestone now, so a ticket moved
// in from another milestone counts from the day it was opened.
//
// There are two forecasts, and a lead picks which ones everyone sees:
// * Plan: a lead's estimate of tickets closed and opened a week. The lines
//   meet when the closed rate beats the opened rate for long enough.
// * Sessions: the tickets closed per shop session over the last N sessions,
//   carried forward session by session over the schedule. Tickets opened
//   (scope added) per session is either measured from the same sessions or
//   set by a lead (0 by default: only the closure rate is forecast). Past the
//   last scheduled session, sessions are assumed to keep coming as often as
//   the recent ones did.

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

// --- Forecast settings ---

// The forecast columns a milestone and a dashboard chart both have. Missing
// on a cached row from before they existed.
export interface ForecastColumns {
    forecast_plan_visible?: boolean;
    forecast_plan_closed_per_week?: number | null;
    forecast_plan_opened_per_week?: number;
    forecast_sessions_visible?: boolean;
    forecast_sessions?: number;
    forecast_sessions_opened_auto?: boolean;
    forecast_sessions_opened_per_session?: number;
}

export interface ForecastSettings {
    planVisible: boolean;
    // Null until a lead sets it; there's no plan forecast without it.
    planClosedPerWeek: number | null;
    planOpenedPerWeek: number;
    sessionsVisible: boolean;
    // How many recent sessions the session forecast is taken from.
    sessions: number;
    // Measure the open rate from those sessions, or use the one set here.
    sessionsOpenedAuto: boolean;
    sessionsOpenedPerSession: number;
}

export const maxForecastSessions = 52;

// With defaults for a row from before the settings existed.
export function forecastSettings(m: ForecastColumns): ForecastSettings {
    return {
        planVisible: m.forecast_plan_visible ?? false,
        planClosedPerWeek: m.forecast_plan_closed_per_week ?? null,
        planOpenedPerWeek: m.forecast_plan_opened_per_week ?? 0,
        sessionsVisible: m.forecast_sessions_visible ?? true,
        sessions: m.forecast_sessions ?? 4,
        sessionsOpenedAuto: m.forecast_sessions_opened_auto ?? false,
        sessionsOpenedPerSession: m.forecast_sessions_opened_per_session ?? 0
    };
}

// The columns to save.
export function forecastFields(m: ForecastColumns): Required<ForecastColumns> {
    const s = forecastSettings(m);
    return {
        forecast_plan_visible: s.planVisible,
        forecast_plan_closed_per_week: s.planClosedPerWeek,
        forecast_plan_opened_per_week: s.planOpenedPerWeek,
        forecast_sessions_visible: s.sessionsVisible,
        forecast_sessions: Math.min(maxForecastSessions, Math.max(1, Math.round(s.sessions))),
        forecast_sessions_opened_auto: s.sessionsOpenedAuto,
        forecast_sessions_opened_per_session: s.sessionsOpenedPerSession
    };
}

// What a settings form edits: number inputs give '' when empty.
export interface ForecastDraft {
    planVisible: boolean;
    planClosed: string | number;
    planOpened: string | number;
    sessionsVisible: boolean;
    sessions: string | number;
    sessionsOpenedAuto: boolean;
    sessionsOpened: string | number;
}

export function forecastDraft(m: ForecastColumns): ForecastDraft {
    const s = forecastSettings(m);
    return {
        planVisible: s.planVisible,
        planClosed: s.planClosedPerWeek ?? '',
        planOpened: s.planOpenedPerWeek,
        sessionsVisible: s.sessionsVisible,
        sessions: s.sessions,
        sessionsOpenedAuto: s.sessionsOpenedAuto,
        sessionsOpened: s.sessionsOpenedPerSession
    };
}

const blank = (v: string | number) => String(v).trim() === '';

// A turned-on plan forecast needs a closed rate.
export function forecastDraftProblem(d: ForecastDraft): string | null {
    if (d.planVisible && blank(d.planClosed)) return 'Set the tickets closed a week for the plan forecast.';
    return null;
}

export function draftColumns(d: ForecastDraft): Required<ForecastColumns> {
    return forecastFields({
        forecast_plan_visible: d.planVisible,
        forecast_plan_closed_per_week: blank(d.planClosed) ? null : Number(d.planClosed),
        forecast_plan_opened_per_week: blank(d.planOpened) ? 0 : Number(d.planOpened),
        forecast_sessions_visible: d.sessionsVisible,
        forecast_sessions: Number(d.sessions) || 4,
        forecast_sessions_opened_auto: d.sessionsOpenedAuto,
        forecast_sessions_opened_per_session: blank(d.sessionsOpened) ? 0 : Number(d.sessionsOpened)
    });
}

// --- Burnup ---

// What a burnup is drawn for: a milestone, or a dashboard chart.
export interface BurnupSource extends ForecastColumns {
    // The chart starts here, or at the first ticket if that's earlier.
    created_at: string;
    target_date: string | null;
    // A closed milestone gets no forecast.
    closed_at?: string | null;
}

export interface BurnupPoint {
    date: string;
    scope: number;
    done: number;
}

export type ForecastKind = 'plan' | 'sessions';

export interface Forecast {
    kind: ForecastKind;
    // Tickets closed (done added) and opened (scope added) per `unit`.
    closedRate: number;
    openedRate: number;
    unit: 'week' | 'session';
    // The sessions the rates came from (session forecast only).
    sessionsUsed: number;
    // The open rate was measured (session forecast) rather than set.
    openedMeasured: boolean;
    // When the lines meet, or null when they don't at these rates.
    completion: string | null;
    // The projected lines from today: through the day they meet, or out to a
    // horizon when they don't. Values can be fractional.
    points: BurnupPoint[];
    // Drawn as steps (one per session) rather than straight lines.
    stepped: boolean;
}

export interface Burnup {
    points: BurnupPoint[];
    // The visible forecasts that could be made, in the order plan, sessions.
    forecasts: Forecast[];
    // Why a visible forecast couldn't be made ("No plan rate set yet.").
    missing: { kind: ForecastKind; reason: string }[];
}

// Projections stop a year out.
export const forecastHorizonDays = 365;
// A forecast that never meets is drawn this far, or to the target date.
const divergingDays = 56;

const dayOf = (iso: string) => toDateString(new Date(iso));
const daysBetween = (a: string, b: string) => Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86_400_000);

export function burnup(tickets: Ticket[], source: BurnupSource, sessions: Session[]): Burnup {
    const end = today();
    let start = dayOf(source.created_at);
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

    const result: Burnup = { points, forecasts: [], missing: [] };
    const last = points[points.length - 1];
    // Nothing to forecast: empty, or everything done.
    if (source.closed_at || last.scope === 0 || last.done >= last.scope) return result;

    const settings = forecastSettings(source);
    const horizon = source.target_date && source.target_date > addDays(end, divergingDays) ? source.target_date : addDays(end, divergingDays);
    const cap = addDays(end, forecastHorizonDays);
    const stopAt = horizon < cap ? horizon : cap;

    if (settings.planVisible) {
        if (settings.planClosedPerWeek === null) result.missing.push({ kind: 'plan', reason: 'No planned rate set yet.' });
        else result.forecasts.push(planForecast(last, settings.planClosedPerWeek, settings.planOpenedPerWeek, stopAt, cap));
    }
    if (settings.sessionsVisible) {
        const opened = settings.sessionsOpenedAuto ? null : settings.sessionsOpenedPerSession;
        const f = sessionsForecast(points, sessions, settings.sessions, opened, stopAt, cap);
        if (typeof f === 'string') result.missing.push({ kind: 'sessions', reason: f });
        else result.forecasts.push(f);
    }
    return result;
}

// Straight lines at the planned weekly rates.
function planForecast(last: BurnupPoint, closed: number, opened: number, stopAt: string, cap: string): Forecast {
    const base = { kind: 'plan' as const, closedRate: closed, openedRate: opened, unit: 'week' as const, sessionsUsed: 0, openedMeasured: false, stepped: false };
    const remaining = last.scope - last.done;
    const gain = closed - opened;
    if (gain > 0) {
        const weeks = remaining / gain;
        const completion = addDays(last.date, Math.ceil(weeks * 7));
        if (completion <= cap) {
            const meet = last.scope + weeks * opened;
            return { ...base, completion, points: [last, { date: completion, scope: meet, done: meet }] };
        }
    }
    // They don't meet (or not within a year): draw out to the horizon.
    const weeks = daysBetween(last.date, stopAt) / 7;
    return {
        ...base,
        completion: null,
        points: [last, { date: stopAt, scope: last.scope + weeks * opened, done: Math.min(last.done + weeks * closed, last.scope + weeks * opened) }]
    };
}

// Per-session rates from the last `n` sessions (the open rate only when
// `opened` is null; otherwise it's that), carried over the sessions to come.
// Returns why there's no forecast instead, when there's nothing to go on.
function sessionsForecast(
    points: BurnupPoint[],
    sessions: Session[],
    n: number,
    opened: number | null,
    stopAt: string,
    cap: string
): Forecast | string {
    const now = Date.now();
    const start = points[0].date;
    const last = points[points.length - 1];
    const valueOn = (date: string) => points.find((p) => p.date === date) ?? { date, scope: 0, done: 0 };

    // Sessions that have started, newest first.
    const past = sessions
        .filter((s) => Date.parse(s.starts_at) <= now)
        .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
        .map((s) => dayOf(s.starts_at));
    const window = past.slice(0, n).filter((d) => d >= start);
    if (window.length === 0) return 'No shop sessions since these tickets started.';

    // What happened since the session before the window (or since the start).
    const before = past[window.length];
    const base = before && before >= start ? valueOn(before) : { date: start, scope: 0, done: 0 };
    const closedRate = (last.done - base.done) / window.length;
    const openedRate = opened ?? (last.scope - base.scope) / window.length;

    // The sessions to come: the schedule, then the recent spacing.
    const oldest = window[window.length - 1];
    const gap = window.length > 1 ? Math.max(1, daysBetween(oldest, window[0]) / (window.length - 1)) : 7;
    const scheduled = sessions
        .filter((s) => Date.parse(s.starts_at) > now)
        .map((s) => dayOf(s.starts_at))
        .filter((d) => d > last.date)
        .sort();
    const sessionDate = (k: number) => {
        if (k <= scheduled.length) return scheduled[k - 1];
        const from = scheduled.length ? scheduled[scheduled.length - 1] : last.date;
        return addDays(from, Math.round((k - scheduled.length) * gap));
    };

    const remaining = last.scope - last.done;
    const gain = closedRate - openedRate;
    const needed = gain > 0 ? Math.ceil(remaining / gain - 1e-9) : Infinity;
    const completion = Number.isFinite(needed) && sessionDate(needed) <= cap ? sessionDate(needed) : null;
    const until = completion ?? stopAt;

    const projected: BurnupPoint[] = [last];
    for (let k = 1; ; k++) {
        const date = sessionDate(k);
        if (date > until) break;
        const scope = last.scope + k * openedRate;
        projected.push({ date, scope, done: Math.min(scope, last.done + k * closedRate) });
        if (completion && k === needed) break;
    }
    // Carry the last step on to the horizon when they don't meet.
    if (!completion && projected[projected.length - 1].date < stopAt) projected.push({ ...projected[projected.length - 1], date: stopAt });

    return {
        kind: 'sessions',
        closedRate,
        openedRate,
        unit: 'session',
        sessionsUsed: window.length,
        openedMeasured: opened === null,
        completion,
        points: projected,
        stepped: true
    };
}

export const forecastLabels: Record<ForecastKind, string> = { plan: 'Plan', sessions: 'Sessions' };
