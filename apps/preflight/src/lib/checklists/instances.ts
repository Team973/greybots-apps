import type { RobotStatusEntry } from '@/lib/robot-status/robot-status';
import type { ScheduleItem } from '@/lib/schedule/types';
import type { ChecklistCheck } from './checks';
import type { MatchLink } from './config';
import type { ChecklistRun } from './runs';

// Checklist instances (issue #82): each run of a checklist belongs to a
// match where that makes sense ("Qual 12 · Pre-match", "Qual 9 → Qual 12 ·
// Bumper swap"), and every run is kept for post-competition review.

export interface MatchContext {
    // The last of our matches to have started, and the next one to start.
    last: ScheduleItem | null;
    next: ScheduleItem | null;
}

export function matchContext(matches: ScheduleItem[], now: number): MatchContext {
    const ours = matches.filter((m) => m.kind === 'match').sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
    return {
        last: [...ours].reverse().find((m) => Date.parse(m.start_at) <= now) ?? null,
        next: ours.find((m) => Date.parse(m.start_at) > now) ?? null
    };
}

export interface InstanceLink {
    // "Qual 12", "Qual 9 → Qual 12", or null when there's no match to name.
    label: string | null;
    // The match records from this run are filed under.
    matchKey: string | null;
}

export function resolveMatchLink(link: MatchLink, ctx: MatchContext): InstanceLink {
    switch (link) {
        case 'last':
            return { label: ctx.last?.title ?? null, matchKey: ctx.last?.match_key ?? null };
        case 'next':
            return { label: ctx.next?.title ?? null, matchKey: ctx.next?.match_key ?? null };
        case 'between': {
            const label = ctx.last && ctx.next ? `${ctx.last.title} → ${ctx.next.title}` : ctx.next?.title ?? ctx.last?.title ?? null;
            // Filed under the match being prepared for.
            return { label, matchKey: ctx.next?.match_key ?? ctx.last?.match_key ?? null };
        }
        default:
            return { label: null, matchKey: null };
    }
}

// "Qual 12 · Pre-match".
export function instanceTitle(name: string, label: string | null): string {
    return label ? `${label} · ${name}` : name;
}

// --- History ---------------------------------------------------------------

export interface ChecklistInstance {
    key: string;
    runId: string;
    checklistId: string;
    name: string;
    // The match it belonged to, if any.
    label: string | null;
    // 'flow' = part of a pit visit's standard sequence; 'adhoc' = started by hand.
    kind: 'flow' | 'adhoc';
    startedAt: string;
    startedBy: string | null;
    // Null while an ad-hoc run is still open. For the sequence, the time of
    // the last step checked.
    completedAt: string | null;
    // Checked steps, in the order they were done.
    checks: ChecklistCheck[];
}

// Every run of every checklist at the event, newest first. Ad-hoc runs come
// from their run rows; runs of the standard sequence are rebuilt from the
// checks, with the start time taken from the robot status log.
export function buildInstances(
    checks: ChecklistCheck[],
    runs: ChecklistRun[],
    statusLog: RobotStatusEntry[],
    matches: ScheduleItem[]
): ChecklistInstance[] {
    const matchTitle = new Map(matches.map((m) => [m.match_key, m.title]));
    const done = checks.filter((c) => c.completed_at);
    const byTime = (a: ChecklistCheck, b: ChecklistCheck) => Date.parse(a.completed_at!) - Date.parse(b.completed_at!);
    const instances: ChecklistInstance[] = [];
    const adhocRunIds = new Set(runs.map((r) => r.id));

    for (const run of runs) {
        instances.push({
            key: run.id,
            runId: run.id,
            checklistId: run.checklist_id,
            name: run.checklist_name,
            label: run.label,
            kind: 'adhoc',
            startedAt: run.started_at,
            startedBy: run.started_by_name,
            completedAt: run.completed_at,
            checks: done.filter((c) => c.run_id === run.id).sort(byTime)
        });
    }

    const groups = new Map<string, ChecklistCheck[]>();
    for (const check of done) {
        if (adhocRunIds.has(check.run_id)) continue;
        const key = `${check.run_id}:${check.checklist_id}`;
        groups.set(key, [...(groups.get(key) ?? []), check]);
    }
    for (const [key, group] of groups) {
        group.sort(byTime);
        const first = group[0];
        const name = first.checklist_name ?? 'Checklist';
        // When the pit switched to this checklist in this run.
        const started = statusLog
            .filter((e) => e.run_id === first.run_id && e.status === 'pending' && e.pending_label === first.checklist_name)
            .sort((a, b) => Date.parse(a.set_at) - Date.parse(b.set_at))[0];
        const matchKey = group.find((c) => c.match_key)?.match_key ?? null;
        instances.push({
            key,
            runId: first.run_id,
            checklistId: first.checklist_id,
            name,
            label: matchKey ? matchTitle.get(matchKey) ?? matchKey : null,
            kind: 'flow',
            startedAt: started?.set_at ?? first.completed_at!,
            startedBy: started?.set_by_name ?? null,
            completedAt: group[group.length - 1].completed_at,
            checks: group
        });
    }

    return instances.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}
