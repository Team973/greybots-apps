import type { ChecklistCheck } from '@/lib/checklists/checks';
import { practiceChecklistId, prematchIndex, type ChecklistSequence } from '@/lib/checklists/config';
import type { RobotStatusEntry } from '@/lib/robot-status/robot-status';
import type { ScheduleItem } from '@/lib/schedule/types';

// Pit statistics, worked out from the robot status log. The log is
// append-only and every entry says when the pit moved to a state, so the time
// spent in a state is the gap to the next entry. Nothing here is stored: the
// stats follow the log.
//
// A *turnaround* is one pit visit: from the robot coming into the pit to it
// being ready. Its time is the sum of the time spent on the pit checklists
// and in repairs. Time spent on the practice field side trip (its checklist,
// and being at the practice field) and time sitting Ready never counts.

// What the pit was doing during a stretch of the log.
type SegmentKind = 'post' | 'pre' | 'repair' | 'practice_prep' | 'practice' | 'ready' | 'out';

interface Segment {
    entry: RobotStatusEntry;
    kind: SegmentKind;
    start: number;
    // Null for the newest entry: that state is still going.
    end: number | null;
}

export interface Turnaround {
    key: string;
    // When the robot came into the pit, and when it was (last) ready.
    startedAt: string;
    readyAt: string;
    // The match it was being turned around for, when that's known.
    matchTitle: string | null;
    // Time per stage, in ms. Post-match is every checklist before the
    // pre-match one; pre-match is that checklist and any after it.
    post: number;
    repair: number;
    pre: number;
    // post + repair + pre, and the same without repairs.
    total: number;
    withoutRepairs: number;
}

export interface Sample {
    ms: number;
    at: string;
}

export interface ChecklistTiming {
    name: string;
    // One per completed run of the checklist. Repair time isn't included.
    samples: Sample[];
}

export interface StepTiming {
    checklist: string;
    step: string;
    samples: number[];
}

export interface PitStats {
    turnarounds: Turnaround[];
    // In the order the checklists run.
    checklists: ChecklistTiming[];
    // Time on the practice field checklist, per trip that went ahead.
    practicePrep: Sample[];
    // Time each checklist step took, slowest (by average) first.
    steps: StepTiming[];
}

function classify(entry: RobotStatusEntry, sequence: ChecklistSequence): SegmentKind {
    switch (entry.status) {
        case 'pending':
            if (entry.checklist_id === practiceChecklistId) return 'practice_prep';
            return (entry.checklist_index ?? 0) >= prematchIndex(sequence) ? 'pre' : 'post';
        case 'repair':
            return 'repair';
        case 'practice':
            return 'practice';
        case 'ready':
            return 'ready';
        default:
            return 'out';
    }
}

// `history` in any order; it's put in the order it was written.
function toSegments(history: RobotStatusEntry[], sequence: ChecklistSequence): Segment[] {
    const ordered = [...history].sort(
        (a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at) || Date.parse(a.set_at) - Date.parse(b.set_at)
    );
    return ordered.map((entry, i) => {
        const start = Date.parse(entry.set_at);
        const next = ordered[i + 1];
        // A clock that jumped backwards (testing mode) can't make time negative.
        return { entry, kind: classify(entry, sequence), start, end: next ? Math.max(start, Date.parse(next.set_at)) : null };
    });
}

const length = (segment: Segment) => (segment.end === null ? 0 : segment.end - segment.start);

function buildTurnarounds(segments: Segment[], matches: ScheduleItem[]): Turnaround[] {
    const ours = matches.filter((m) => m.kind === 'match').sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
    const matchByKey = new Map(ours.map((m) => [m.match_key, m]));
    const turnarounds: Turnaround[] = [];

    interface Open {
        start: number;
        post: number;
        repair: number;
        pre: number;
        readyAt: number | null;
        // Still working (the newest entry is a checklist or repair).
        unfinished: boolean;
    }
    let open: Open | null = null;

    const close = (current: Open, departedFor: string | null) => {
        if (current.readyAt === null || current.unfinished) return;
        const total = current.post + current.repair + current.pre;
        // The match it left for; failing that, the first match after it was ready.
        const match = (departedFor ? matchByKey.get(departedFor) : null) ?? ours.find((m) => Date.parse(m.start_at) >= current.readyAt!) ?? null;
        turnarounds.push({
            key: String(current.start),
            startedAt: new Date(current.start).toISOString(),
            readyAt: new Date(current.readyAt).toISOString(),
            matchTitle: match?.title ?? null,
            post: current.post,
            repair: current.repair,
            pre: current.pre,
            total,
            withoutRepairs: current.post + current.pre
        });
    };

    for (const segment of segments) {
        if (segment.kind === 'out') {
            if (open) close(open, segment.entry.status === 'away' ? segment.entry.match_key : null);
            open = null;
            continue;
        }
        open ??= { start: segment.start, post: 0, repair: 0, pre: 0, readyAt: null, unfinished: false };
        if (segment.kind === 'ready') {
            open.readyAt = segment.start;
        } else if (segment.kind === 'post' || segment.kind === 'pre' || segment.kind === 'repair') {
            open[segment.kind] += length(segment);
            if (segment.end === null) open.unfinished = true;
        }
        // practice_prep and practice: part of the visit, never of its time.
    }
    // The robot is sitting Ready right now: that turnaround is done.
    if (open) close(open, null);
    return turnarounds;
}

// Time on each run of each pit checklist, leaving out the repairs that
// interrupted it. A run only counts once the pit moved on from it (to the
// next checklist, or Ready): one abandoned part-way would drag the average
// down.
function buildChecklistTimings(segments: Segment[], sequence: ChecklistSequence): { checklists: ChecklistTiming[]; practicePrep: Sample[] } {
    interface Run {
        name: string;
        practice: boolean;
        ms: number;
        at: number;
        done: boolean;
    }
    const runs = new Map<string, Run>();

    segments.forEach((segment, i) => {
        if (!['post', 'pre', 'practice_prep'].includes(segment.kind) || segment.end === null) return;
        const entry = segment.entry;
        const name = entry.pending_label ?? 'Checklist';
        const key = `${entry.run_id}:${segment.kind === 'practice_prep' ? practiceChecklistId : entry.checklist_index}:${name}`;
        const run = runs.get(key) ?? { name, practice: segment.kind === 'practice_prep', ms: 0, at: segment.start, done: false };
        run.ms += length(segment);

        // What the pit did next decides whether this run was finished.
        const next = segments[i + 1];
        if (next) {
            if (segment.kind === 'practice_prep') {
                run.done = next.kind === 'practice';
            } else if (next.kind === 'ready') {
                run.done = true;
            } else if ((next.kind === 'post' || next.kind === 'pre') && next.entry.run_id === entry.run_id) {
                run.done = (next.entry.checklist_index ?? 0) > (entry.checklist_index ?? 0);
            }
        }
        runs.set(key, run);
    });

    const done = [...runs.values()].filter((r) => r.done);
    const sample = (r: Run): Sample => ({ ms: r.ms, at: new Date(r.at).toISOString() });

    // Listed in the order the checklists run today, then any that were renamed
    // or removed since.
    const order = sequence.checklists.map((c) => c.name);
    const names = [...new Set([...order, ...done.filter((r) => !r.practice).map((r) => r.name)])];
    const checklists = names
        .map((name) => ({ name, samples: done.filter((r) => !r.practice && r.name === name).map(sample) }))
        .filter((c) => c.samples.length > 0 || order.includes(c.name));

    return { checklists, practicePrep: done.filter((r) => r.practice).map(sample) };
}

// How long each step took: the time from the step before it (or from the
// checklist starting) to it being checked, counting only the time the pit
// was actually on that checklist (so a repair in the middle isn't blamed on
// the step that came after it).
function buildStepTimings(segments: Segment[], checks: ChecklistCheck[]): StepTiming[] {
    const working = segments.filter((s) => ['post', 'pre', 'practice_prep'].includes(s.kind));
    const byStep = new Map<string, StepTiming>();

    const groups = new Map<string, ChecklistCheck[]>();
    for (const check of checks) {
        if (!check.completed_at) continue;
        const key = `${check.run_id}:${check.checklist_id}`;
        groups.set(key, [...(groups.get(key) ?? []), check]);
    }

    for (const group of groups.values()) {
        group.sort((a, b) => Date.parse(a.completed_at!) - Date.parse(b.completed_at!));
        const first = group[0];
        // The stretches of the log spent on this checklist, in this run.
        const spans = working.filter((s) => s.entry.run_id === first.run_id && s.entry.pending_label === first.checklist_name);
        if (!spans.length) continue; // An ad-hoc run: no status log to time it against.

        let previous = spans[0].start;
        for (const check of group) {
            const at = Date.parse(check.completed_at!);
            let ms = 0;
            for (const span of spans) {
                const end = span.end ?? at;
                ms += Math.max(0, Math.min(at, end) - Math.max(previous, span.start));
            }
            previous = Math.max(previous, at);

            const checklist = check.checklist_name ?? 'Checklist';
            const step = check.step_title ?? 'Step';
            const key = `${checklist}\u0000${step}`;
            const timing = byStep.get(key) ?? { checklist, step, samples: [] };
            timing.samples.push(ms);
            byStep.set(key, timing);
        }
    }
    return [...byStep.values()].sort((a, b) => mean(b.samples) - mean(a.samples));
}

export function buildPitStats(
    history: RobotStatusEntry[],
    checks: ChecklistCheck[],
    sequence: ChecklistSequence,
    matches: ScheduleItem[]
): PitStats {
    const segments = toSegments(history, sequence);
    return {
        turnarounds: buildTurnarounds(segments, matches),
        ...buildChecklistTimings(segments, sequence),
        steps: buildStepTimings(segments, checks)
    };
}

// --- Numbers -----------------------------------------------------------------

export function mean(values: number[]): number {
    return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

export function median(values: number[]): number {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// "45s", "12m 30s", "1h 05m": short enough to read at a glance.
export function formatDuration(ms: number): string {
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return seconds % 60 ? `${minutes}m ${String(seconds % 60).padStart(2, '0')}s` : `${minutes}m`;
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

export interface HistogramBin {
    // "0–5m".
    label: string;
    from: number;
    to: number;
    count: number;
}

const minute = 60_000;
// Bin widths that read as round numbers.
const binWidths = [0.5, 1, 2, 5, 10, 15, 30, 60].map((m) => m * minute);

// Buckets durations into at most `maxBins` equal, round-numbered bins
// starting at zero.
export function histogram(values: number[], maxBins = 8): HistogramBin[] {
    if (!values.length) return [];
    const max = Math.max(...values);
    const width = binWidths.find((w) => max / w < maxBins) ?? binWidths[binWidths.length - 1];
    const count = Math.max(1, Math.floor(max / width) + 1);
    const label = (ms: number) => (ms % minute === 0 ? `${ms / minute}m` : formatDuration(ms));
    return Array.from({ length: count }, (_, i) => {
        const from = i * width;
        const to = from + width;
        return { label: `${label(from)}–${label(to)}`, from, to, count: values.filter((v) => v >= from && v < to).length };
    });
}
