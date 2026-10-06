import type { Battery, BatteryUse } from '@/lib/batteries/batteries';
import type { ChecklistCheck } from '@/lib/checklists/checks';
import { buildInstances, type ChecklistInstance } from '@/lib/checklists/instances';
import type { ChecklistRun } from '@/lib/checklists/runs';
import type { Repair } from '@/lib/repairs/repairs';
import { statusText } from '@/lib/robot-status/robot-status';
import type { ScheduleItem } from '@/lib/schedule/types';
import { buildPitStats, formatDuration, mean, median, type PitStats } from '@/lib/stats/pit-stats';
import type { Task } from '@/lib/tasks/tasks';
import type { EventData } from './event-data';

// The event report (issue #110): everything on the printed report is worked
// out here from the event's data, so the page only lays it out. Nothing is
// stored.

export type LogKind = 'match' | 'status' | 'checklist' | 'check' | 'repair' | 'task' | 'note' | 'battery';

export const logKindLabels: Record<LogKind, string> = {
    match: 'Match',
    status: 'Status',
    checklist: 'Checklist',
    check: 'Step',
    repair: 'Repair',
    task: 'Task',
    note: 'Note',
    battery: 'Battery'
};

// One line of the as-run notes: something that happened in the pit.
export interface LogEntry {
    at: string;
    kind: LogKind;
    text: string;
    detail: string | null;
    by: string | null;
}

export interface StageTotal {
    key: 'post' | 'repair' | 'pre';
    label: string;
    ms: number;
}

// How long before its match the robot was ready. Negative: ready after the
// match started.
export interface ReadyMargin {
    matchTitle: string;
    ms: number;
}

export interface SubsystemRepairs {
    name: string;
    count: number;
    // Time worked, over the repairs that were finished.
    ms: number;
}

export interface BatteryUseRow {
    use: BatteryUse;
    number: number | null;
}

export interface EventReport {
    stats: PitStats;
    // Our matches, in order.
    matches: ScheduleItem[];
    matchesPlayed: number;
    stages: StageTotal[];
    margins: ReadyMargin[];
    instances: ChecklistInstance[];
    repairsBySubsystem: SubsystemRepairs[];
    // Oldest first.
    repairLog: Repair[];
    failedChecks: ChecklistCheck[];
    batteryUses: BatteryUseRow[];
    outstanding: {
        repairs: Repair[];
        tasks: Task[];
        runs: ChecklistRun[];
        batteries: Battery[];
    };
    highlights: string[];
    improvements: string[];
    log: LogEntry[];
}

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const byTime = <T>(at: (row: T) => string) => (a: T, b: T) => Date.parse(at(a)) - Date.parse(at(b));

// The robot was ready with less than this to spare before its match.
const tightMarginMs = 10 * 60_000;

export function repairDuration(repair: Repair): number | null {
    if (!repair.started_at || !repair.finished_at) return null;
    return Math.max(0, Date.parse(repair.finished_at) - Date.parse(repair.started_at));
}

function buildLog(data: EventData, matches: ScheduleItem[], batteryNumber: (id: string) => number | null): LogEntry[] {
    const log: LogEntry[] = [];
    const add = (at: string | null | undefined, kind: LogKind, text: string, by: string | null = null, detail: string | null = null) => {
        if (at) log.push({ at, kind, text, detail: detail?.trim() || null, by });
    };

    for (const match of matches) {
        const alliance = match.match_info?.alliance;
        add(match.times?.actualStart, 'match', `${match.title} started`, null, alliance ? `${alliance === 'red' ? 'Red' : 'Blue'} alliance` : null);
    }

    for (const entry of data.history) {
        add(entry.set_at, 'status', statusText(entry), entry.set_by_name, entry.note);
    }

    for (const run of data.runs) {
        const name = run.label ? `${run.label} · ${run.checklist_name}` : run.checklist_name;
        add(run.started_at, 'checklist', `Started ${name}`, run.started_by_name);
        add(run.completed_at, 'checklist', `Finished ${name}`, run.completed_by_name);
    }

    for (const check of data.checks) {
        const value = check.value === 'pass' ? 'Passed' : check.value === 'fail' ? 'FAILED' : check.value ? `Recorded: ${check.value}` : null;
        add(check.completed_at, 'check', `${check.checklist_name ?? 'Checklist'}: ${check.step_title ?? 'Step'}`, check.completed_by_name, value);
    }

    for (const repair of data.repairs) {
        const what = [repair.title, repair.subsystem ? `(${repair.subsystem})` : ''].filter(Boolean).join(' ');
        const startedAtOnce = repair.started_at === repair.reported_at;
        add(repair.reported_at, 'repair', `${startedAtOnce ? 'Repair logged and started' : 'Repair logged'}: ${what}`, repair.reported_by_name, repair.details);
        if (!startedAtOnce) add(repair.started_at, 'repair', `Repair started: ${what}`, repair.started_by_name);
        const took = repairDuration(repair);
        add(repair.finished_at, 'repair', `Repair finished: ${what}`, repair.finished_by_name, took === null ? null : `Took ${formatDuration(took)}`);
    }

    for (const task of data.tasks) {
        add(task.started_at, 'task', `Task started: ${task.title}`, task.started_by_name);
        add(task.completed_at, 'task', `Task done: ${task.title}`, task.completed_by_name, task.notes);
    }

    for (const note of data.notes) {
        add(note.noted_at, 'note', note.title || 'Note', note.created_by_name, note.body);
    }

    for (const use of data.uses) {
        const number = batteryNumber(use.battery_id);
        const battery = number === null ? 'A battery' : `Battery ${number}`;
        add(use.installed_at, 'battery', `${battery} installed${use.label ? ` for ${use.label}` : ''}`, use.installed_by_name);
        const wh = use.wh_discharged === null || use.wh_discharged === undefined ? null : `${Number(use.wh_discharged)} Wh discharged`;
        add(use.removed_at, 'battery', `${battery} removed`, use.removed_by_name, wh);
    }

    return log.sort(byTime((entry) => entry.at));
}

// `now` is the app clock: a match counts as played once it has started.
export function buildEventReport(data: EventData, now: number): EventReport {
    const matches = data.items.filter((item) => item.kind === 'match').sort(byTime((m) => m.start_at));
    const matchesPlayed = matches.filter((m) => !!m.times?.actualStart || !!m.times?.completed || Date.parse(m.end_at) <= now).length;
    const stats = buildPitStats(data.history, data.checks, data.sequence, data.items);
    const turnarounds = stats.turnarounds;
    const instances = buildInstances(data.checks, data.runs, data.history, data.items);

    const stageSum = (key: StageTotal['key']) => turnarounds.reduce((total, t) => total + t[key], 0);
    const stages: StageTotal[] = [
        { key: 'post', label: 'Post-match', ms: stageSum('post') },
        { key: 'repair', label: 'Repairs', ms: stageSum('repair') },
        { key: 'pre', label: 'Pre-match', ms: stageSum('pre') }
    ];

    const matchByTitle = new Map(matches.map((m) => [m.title, m]));
    const margins: ReadyMargin[] = [];
    for (const t of turnarounds) {
        const match = t.matchTitle ? matchByTitle.get(t.matchTitle) : null;
        if (match) margins.push({ matchTitle: match.title, ms: Date.parse(match.times?.actualStart ?? match.start_at) - Date.parse(t.readyAt) });
    }

    const subsystems = new Map<string, SubsystemRepairs>();
    for (const repair of data.repairs) {
        const name = repair.subsystem ?? 'Not specified';
        const entry = subsystems.get(name) ?? { name, count: 0, ms: 0 };
        entry.count += 1;
        entry.ms += repairDuration(repair) ?? 0;
        subsystems.set(name, entry);
    }
    const repairsBySubsystem = [...subsystems.values()].sort((a, b) => b.count - a.count || b.ms - a.ms);

    const batteryById = new Map(data.batteries.map((b) => [b.id, b]));
    const batteryNumber = (id: string) => batteryById.get(id)?.number ?? null;

    const outstanding = {
        repairs: data.repairs.filter((r) => r.status !== 'done').sort(byTime((r) => r.reported_at)),
        tasks: data.tasks.filter((t) => !t.completed_at),
        runs: data.runs.filter((r) => !r.completed_at),
        batteries: data.batteries.filter((b) => b.status === 'suspect')
    };
    const outstandingCount = outstanding.repairs.length + outstanding.tasks.length + outstanding.runs.length + outstanding.batteries.length;
    const failedChecks = data.checks.filter((c) => c.completed_at && c.value === 'fail').sort(byTime((c) => c.completed_at!));

    // --- Highlights and areas of improvement ---
    const highlights: string[] = [];
    const improvements: string[] = [];
    const totals = turnarounds.map((t) => t.total);
    const repaired = turnarounds.filter((t) => t.repair > 0);
    const stepsChecked = data.checks.filter((c) => c.completed_at).length;
    const doneRepairs = data.repairs.filter((r) => r.status === 'done').length;
    const doneTasks = data.tasks.filter((t) => t.completed_at).length;

    if (matches.length) highlights.push(`${matchesPlayed} of ${plural(matches.length, 'match', 'matches')} played.`);
    if (turnarounds.length) {
        highlights.push(`${plural(turnarounds.length, 'turnaround')} completed, averaging ${formatDuration(mean(totals))} (median ${formatDuration(median(totals))}).`);
        const fastest = [...turnarounds].sort((a, b) => a.total - b.total)[0];
        highlights.push(`Fastest turnaround: ${formatDuration(fastest.total)}${fastest.matchTitle ? `, before ${fastest.matchTitle}` : ''}.`);
        const clean = turnarounds.length - repaired.length;
        if (clean) highlights.push(`${clean} of ${plural(turnarounds.length, 'turnaround')} needed no repairs.`);
    }
    const early = margins.filter((m) => m.ms > 0);
    if (early.length) highlights.push(`The robot was ready ${formatDuration(mean(early.map((m) => m.ms)))} before its match on average.`);
    if (stepsChecked) highlights.push(`${plural(stepsChecked, 'checklist step')} checked off across ${plural(instances.length, 'checklist run')}.`);
    if (data.repairs.length) highlights.push(`${doneRepairs} of ${plural(data.repairs.length, 'repair')} finished.`);
    if (data.tasks.length) highlights.push(`${doneTasks} of ${plural(data.tasks.length, 'task')} completed.`);

    const allStages = stages.reduce((total, s) => total + s.ms, 0);
    if (allStages > 0) {
        const top = [...stages].sort((a, b) => b.ms - a.ms)[0];
        improvements.push(`${top.label} takes the most pit time: ${Math.round((top.ms / allStages) * 100)}% of all turnaround time.`);
    }
    if (repaired.length) {
        improvements.push(
            `Repairs interrupted ${repaired.length} of ${plural(turnarounds.length, 'turnaround')} and added ${formatDuration(mean(repaired.map((t) => t.repair)))} each time on average.`
        );
    }
    const slowest = stats.steps.find((s) => mean(s.samples) > 0);
    if (slowest) improvements.push(`The slowest step is “${slowest.step}” (${slowest.checklist}): ${formatDuration(mean(slowest.samples))} on average.`);
    if (turnarounds.length >= 3) {
        const worst = [...turnarounds].sort((a, b) => b.total - a.total)[0];
        const typical = median(totals);
        if (worst.total > typical * 1.5) {
            improvements.push(
                `The longest turnaround${worst.matchTitle ? ` (before ${worst.matchTitle})` : ''} took ${formatDuration(worst.total)}, against a typical ${formatDuration(typical)}.`
            );
        }
    }
    const tight = margins.filter((m) => m.ms < tightMarginMs);
    if (tight.length) {
        improvements.push(
            `${plural(tight.length, 'time')} the robot was ready less than 10 minutes before its match (${tight.map((m) => m.matchTitle).join(', ')}).`
        );
    }
    const worstSubsystem = repairsBySubsystem.find((s) => s.name !== 'Not specified');
    if (worstSubsystem && worstSubsystem.count > 1) improvements.push(`${worstSubsystem.name} needed the most repairs: ${worstSubsystem.count}.`);
    if (failedChecks.length) improvements.push(`${plural(failedChecks.length, 'checklist step')} failed its check.`);
    if (outstandingCount) improvements.push(`${plural(outstandingCount, 'item')} still open at the end of the event (see Outstanding items).`);

    return {
        stats,
        matches,
        matchesPlayed,
        stages,
        margins,
        instances,
        repairsBySubsystem,
        repairLog: [...data.repairs].sort(byTime((r) => r.reported_at)),
        failedChecks,
        batteryUses: [...data.uses].sort(byTime((u) => u.installed_at)).map((use) => ({ use, number: batteryNumber(use.battery_id) })),
        outstanding,
        highlights,
        improvements,
        log: buildLog(data, matches, batteryNumber)
    };
}
