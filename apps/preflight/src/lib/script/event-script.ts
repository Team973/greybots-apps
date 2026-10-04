import { batteryRotation, recommendBattery, type Battery, type BatteryUse } from '@/lib/batteries/batteries';
import {
    sequenceMatchLink,
    stepConditionLabels,
    stepInput,
    type ChecklistDef,
    type ChecklistSequence,
    type ChecklistStep,
    type PitRole,
    type StepInput
} from '@/lib/checklists/config';
import { matchDeadlines, type MatchPrep } from '@/lib/schedule/timing';
import type { ScheduleItem } from '@/lib/schedule/types';

// The event script: the match schedule and the pit checklists combined into
// one printable run of the rest of the event, for people who work from
// paper. Each upcoming match gets a page with its times, its alliance, and
// the checklists that go with it, already worked out for that match (which
// bumpers, which battery). Generic copies of every checklist follow, for
// when the details can't be known ahead (playoffs).
//
// Everything here is plain data built from what the device already has, so
// the script can be made with no internet.

type Alliance = 'red' | 'blue';

export interface ScriptStep {
    title: string;
    instructions: string;
    // "Mechanical (Avery)", or just "Mechanical" when nobody holds the role.
    who: string[];
    input: StepInput;
    // Worked out for this match (e.g. "Swap red → blue"), or what the step
    // depends on in a generic copy.
    note: string | null;
    // Doesn't apply to this match: printed struck through.
    skipped: boolean;
}

export interface ScriptChecklist {
    name: string;
    steps: ScriptStep[];
}

export interface ScriptBumpers {
    // null = can't tell from the schedule.
    swap: boolean | null;
    from: Alliance | null;
    to: Alliance | null;
}

export interface ScriptMatch {
    key: string;
    title: string;
    start: string;
    // The start is an estimate (a prediction, a manual delay, or an override).
    estimated: boolean;
    queueAt: number;
    prepAt: number;
    alliance: Alliance | null;
    partners: string[];
    opponents: string[];
    bumpers: ScriptBumpers;
    // The battery the rotation says goes in for this match.
    batteryNumber: number | null;
    // Done before the match (pre-match) and after it (post-match).
    before: ScriptChecklist[];
    after: ScriptChecklist[];
}

export interface ScriptInput {
    // Every match of ours at the event, any order.
    matches: ScheduleItem[];
    now: number;
    sequence: ChecklistSequence;
    roles: PitRole[];
    prep: MatchPrep;
    batteries: Battery[];
    // Newest first.
    uses: BatteryUse[];
    // The battery set in use (null = every set).
    batterySet?: string | null;
}

const colorName = (a: Alliance) => (a === 'red' ? 'RED' : 'BLUE');

function allianceOf(match: ScheduleItem | undefined): Alliance | null {
    const a = match?.match_info?.alliance;
    return a === 'red' || a === 'blue' ? a : null;
}

function whoFor(step: ChecklistStep, roles: PitRole[]): string[] {
    const byId = new Map(roles.map((r) => [r.id, r]));
    return step.role_ids
        .map((id) => byId.get(id))
        .filter((r): r is PitRole => !!r)
        .map((r) => (r.assignee.trim() ? `${r.name} (${r.assignee.trim()})` : r.name));
}

// A step as it applies to one match.
function matchStep(step: ChecklistStep, roles: PitRole[], bumpers: ScriptBumpers, batteryNumber: number | null): ScriptStep {
    const input = stepInput(step);
    let note: string | null = null;
    let skipped = false;

    if (step.condition === 'bumper_swap' || step.condition === 'bumper_hint') {
        if (bumpers.swap === true && bumpers.from && bumpers.to) {
            note = `Swap ${colorName(bumpers.from)} → ${colorName(bumpers.to)}`;
        } else if (bumpers.swap === false && bumpers.to) {
            note = `No swap: staying ${colorName(bumpers.to)}`;
            // A swap step is skipped; a hint step is still done.
            skipped = step.condition === 'bumper_swap';
        } else if (bumpers.to) {
            note = `This match is ${colorName(bumpers.to)}. Check what's on the robot.`;
        } else {
            note = 'Alliance not known yet. Check the schedule.';
        }
    }
    if (input === 'battery' && batteryNumber !== null) note = `Next in the rotation: battery ${batteryNumber}`;

    return { title: step.title, instructions: step.instructions, who: whoFor(step, roles), input, note, skipped };
}

// A step with nothing worked out, for the generic copies.
function genericStep(step: ChecklistStep, roles: PitRole[]): ScriptStep {
    return {
        title: step.title,
        instructions: step.instructions,
        who: whoFor(step, roles),
        input: stepInput(step),
        note: step.condition ? stepConditionLabels[step.condition] : null,
        skipped: false
    };
}

// One page per match of ours that hasn't started yet (on the app clock), in
// order. Pre-match checklists come before the match and post-match ones after
// it, by the same rule the Overview uses to name each run.
export function buildMatchScripts(input: ScriptInput): ScriptMatch[] {
    const ours = input.matches.filter((m) => m.kind === 'match').sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
    const rotation = batteryRotation(input.batteries, input.batterySet ?? null);
    // Where the rotation stands now; it moves on one battery per match.
    let battery = recommendBattery(input.batteries, input.uses, input.batterySet ?? null);

    const before: ChecklistDef[] = [];
    const after: ChecklistDef[] = [];
    input.sequence.checklists.forEach((checklist, index) => {
        (sequenceMatchLink(input.sequence, index) === 'last' ? after : before).push(checklist);
    });

    const scripts: ScriptMatch[] = [];
    ours.forEach((match, index) => {
        if (Date.parse(match.start_at) <= input.now) return;

        const alliance = allianceOf(match);
        const previous = allianceOf(ours[index - 1]);
        const bumpers: ScriptBumpers = { swap: alliance && previous ? alliance !== previous : null, from: previous, to: alliance };
        const batteryNumber = battery?.number ?? null;
        const info = match.match_info;
        const deadlines = matchDeadlines(match, input.prep);
        const teams = (side: Alliance) => (info?.[side] ?? []).map(String);
        const render = (list: ChecklistDef[]): ScriptChecklist[] =>
            list.map((c) => ({ name: c.name, steps: c.steps.map((s) => matchStep(s, input.roles, bumpers, batteryNumber)) }));

        scripts.push({
            key: match.match_key ?? match.id,
            title: match.title,
            start: match.start_at,
            estimated: !!match.times && !['actual', 'published'].includes(match.times.source),
            queueAt: deadlines.queueAt,
            prepAt: deadlines.prepAt,
            alliance,
            partners: alliance ? teams(alliance) : [],
            opponents: alliance ? teams(alliance === 'red' ? 'blue' : 'red') : [],
            bumpers,
            batteryNumber,
            before: render(before),
            after: render(after)
        });

        // The next match gets the next battery, wrapping to the lowest.
        if (battery) battery = rotation.find((b) => b.number > battery!.number) ?? rotation[0] ?? null;
    });
    return scripts;
}

export interface GenericChecklist {
    key: string;
    // Where it's used, e.g. "Every pit visit".
    group: string;
    checklist: ScriptChecklist;
}

// A blank copy of every checklist, nothing filled in: for playoffs (where the
// alliance color isn't known until the match before), and for the practice
// field and the checklists that are started by hand.
export function buildGenericChecklists(
    sequence: ChecklistSequence,
    flow: { startOfDay: ChecklistDef | null; practice: ChecklistDef | null; endOfDay: ChecklistDef | null },
    adhoc: ChecklistDef[],
    roles: PitRole[]
): GenericChecklist[] {
    const render = (c: ChecklistDef): ScriptChecklist => ({ name: c.name || 'Untitled checklist', steps: c.steps.map((s) => genericStep(s, roles)) });
    const one = (c: ChecklistDef | null, group: string) => (c ? [{ key: `flow:${c.id}`, group, checklist: render(c) }] : []);
    // In the order they come up through a day.
    return [
        ...one(flow.startOfDay, 'When the day starts'),
        ...sequence.checklists.map((c) => ({ key: `sequence:${c.id}`, group: 'Every pit visit', checklist: render(c) })),
        ...one(flow.practice, 'Before the practice field'),
        ...one(flow.endOfDay, 'When the day ends'),
        ...adhoc.map((c) => ({ key: `adhoc:${c.id}`, group: 'When needed', checklist: render(c) }))
    ];
}
