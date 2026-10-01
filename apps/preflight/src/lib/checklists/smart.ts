import type { ScheduleItem } from '@/lib/schedule/types';
import { isStepDone, type ChecklistCheck } from './checks';
import type { ChecklistDef, ChecklistStep } from './config';

// "Smart" checklist steps decide from the schedule whether they apply. A
// step that doesn't apply is shown as skipped (grayed out, with the reason)
// and counts as complete. Skips are computed, not stored, so they follow
// schedule changes; if the schedule can't tell, the step stays a normal step.

type Alliance = 'red' | 'blue';

export interface BumperSwap {
    // null = can't tell from the schedule (the step stays manual).
    needed: boolean | null;
    current: Alliance | null;
    next: Alliance | null;
    lastMatch: ScheduleItem | null;
    nextMatch: ScheduleItem | null;
    reason: string;
}

const colorName = (a: Alliance) => (a === 'red' ? 'red' : 'blue');

// Bumpers are on the color of the last match we played; a swap is needed
// when our next match is on the other alliance.
export function bumperSwap(matches: ScheduleItem[], now: number): BumperSwap {
    const ours = matches
        .filter((m) => m.kind === 'match' && m.match_info?.alliance)
        .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
    const lastMatch = [...ours].reverse().find((m) => Date.parse(m.start_at) <= now) ?? null;
    const nextMatch = ours.find((m) => Date.parse(m.start_at) > now) ?? null;
    const current = (lastMatch?.match_info?.alliance as Alliance | undefined) ?? null;
    const next = (nextMatch?.match_info?.alliance as Alliance | undefined) ?? null;

    if (!nextMatch || !next) {
        return { needed: null, current, next, lastMatch, nextMatch, reason: 'No upcoming match on the schedule' };
    }
    if (!lastMatch || !current) {
        return { needed: null, current, next, lastMatch, nextMatch, reason: `${nextMatch.title} is ${colorName(next)}; no earlier match to compare` };
    }
    return current === next
        ? { needed: false, current, next, lastMatch, nextMatch, reason: `Staying ${colorName(next)} for ${nextMatch.title}` }
        : { needed: true, current, next, lastMatch, nextMatch, reason: `${colorName(current)} → ${colorName(next)} for ${nextMatch.title}` };
}

export interface StepContext {
    matches: ScheduleItem[];
    now: number;
}

export interface SmartInfo {
    // True when the step doesn't apply right now.
    skipped: boolean;
    // Why, or what it's about (e.g. "red → blue for Qual 12").
    note: string | null;
}

export function evaluateStep(step: ChecklistStep, ctx: StepContext): SmartInfo {
    if (step.condition === 'bumper_swap') {
        const swap = bumperSwap(ctx.matches, ctx.now);
        return { skipped: swap.needed === false, note: swap.reason };
    }
    return { skipped: false, note: null };
}

export type StepState = 'done' | 'skipped' | 'todo';

export function stepState(checks: ChecklistCheck[], checklist: ChecklistDef, step: ChecklistStep, ctx: StepContext): StepState {
    if (isStepDone(checks, checklist.id, step.id)) return 'done';
    return evaluateStep(step, ctx).skipped ? 'skipped' : 'todo';
}

// Index of the first step still to do (steps go in order; skipped steps
// count as complete). Equals steps.length when the checklist is complete.
export function activeStepIndex(checks: ChecklistCheck[], checklist: ChecklistDef, ctx: StepContext): number {
    const index = checklist.steps.findIndex((s) => stepState(checks, checklist, s, ctx) === 'todo');
    return index === -1 ? checklist.steps.length : index;
}
