import { getSetting, saveSetting } from '@/lib/settings';

// Pit checklist configuration (issue #82), kept as shared settings that
// leads edit on the Pit setup page:
// - the pit roles roster: who currently does each job,
// - one standard sequence of checklists that runs every time the robot
//   comes back to the pit, and
// - the practice field, start of day, and end of day checklists, which the
//   pit flow runs at fixed points, and
// - ad-hoc checklists that are started by hand when needed (a subsystem
//   deep dive, a bumper swap).

export interface PitRole {
    id: string;
    name: string;
    // A name picked from lib/people.ts (account holders and kiosk crew).
    assignee: string;
}

// A "smart" step only applies in some situations; when it doesn't, it's
// shown as skipped and checked off automatically. See ./smart.ts.
//   bumper_swap: skipped when the bumpers are already the next match's color.
//   bumper_hint: never skipped; it just says whether a swap is worth doing
//                now (for when the color doesn't matter yet, e.g. practice).
export type StepCondition = 'bumper_swap' | 'bumper_hint';

export const stepConditionLabels: Record<StepCondition, string> = {
    bumper_swap: 'Only if a bumper swap is needed (from the TBA schedule)',
    bumper_hint: 'Always, and suggest a bumper swap if the next match is another color'
};

// What a step records when it's completed, beyond who and when.
//   check:     nothing more (a plain checkbox)
//   text:      free text, e.g. driver feedback
//   pass_fail: pass or fail
//   battery:   which battery went in the robot (also assigns it to the match)
export type StepInput = 'check' | 'text' | 'pass_fail' | 'battery';

export const stepInputs: StepInput[] = ['check', 'text', 'pass_fail', 'battery'];

export const stepInputLabels: Record<StepInput, string> = {
    check: 'Just check it off',
    text: 'Text (e.g. feedback)',
    pass_fail: 'Pass or fail',
    battery: 'Which battery is installed'
};

export interface ChecklistStep {
    id: string;
    title: string;
    instructions: string;
    // PitRole ids involved in this step.
    role_ids: string[];
    condition?: StepCondition | null;
    // Absent on steps saved before inputs existed: a plain checkbox.
    input?: StepInput;
}

// Which of our matches a run of the checklist belongs to, e.g. post-match
// goes with the match just played and pre-match with the next one. Used to
// name each run ("Qual 12 · Pre-match") and to link its records to the match.
export type MatchLink = 'last' | 'next' | 'between' | 'none';

export const matchLinkLabels: Record<MatchLink, string> = {
    last: 'The match just played',
    next: 'The next match',
    between: 'Between those two matches',
    none: 'No match'
};

export interface ChecklistDef {
    id: string;
    name: string;
    steps: ChecklistStep[];
    // The checklist "Repairs" can jump straight to once repairs are done.
    prematch?: boolean;
    // Absent = decided by where the checklist is; see defaultMatchLink().
    match_link?: MatchLink;
}

export interface ChecklistSequence {
    checklists: ChecklistDef[];
}

const pitRolesKey = 'pit_roles';
const sequenceKey = 'checklist_sequence';
const adhocKey = 'adhoc_checklists';
// Three checklists are a fixed part of the pit flow (see lib/robot-status),
// so they have fixed ids rather than generated ones:
// - practice:     before the robot goes to the practice field
// - start_of_day: when the day is started
// - end_of_day:   when the day is ended
export const practiceChecklistId = 'practice';
export const startOfDayChecklistId = 'start_of_day';
export const endOfDayChecklistId = 'end_of_day';
export type FlowChecklistId = typeof practiceChecklistId | typeof startOfDayChecklistId | typeof endOfDayChecklistId;
export const flowChecklistIds: FlowChecklistId[] = [practiceChecklistId, startOfDayChecklistId, endOfDayChecklistId];

const flowChecklistKeys: Record<FlowChecklistId, string> = {
    practice: 'practice_checklist',
    start_of_day: 'start_of_day_checklist',
    end_of_day: 'end_of_day_checklist'
};

export async function getPitRoles(): Promise<PitRole[]> {
    return (await getSetting<{ roles: PitRole[] }>(pitRolesKey))?.roles ?? [];
}

export function savePitRoles(roles: PitRole[], editorName: string | null) {
    return saveSetting(pitRolesKey, { roles }, editorName);
}

export async function getChecklistSequence(): Promise<ChecklistSequence> {
    return (await getSetting<ChecklistSequence>(sequenceKey)) ?? { checklists: [] };
}

export function saveChecklistSequence(sequence: ChecklistSequence, editorName: string | null) {
    return saveSetting(sequenceKey, sequence, editorName);
}

export async function getAdhocChecklists(): Promise<ChecklistDef[]> {
    return (await getSetting<ChecklistSequence>(adhocKey))?.checklists ?? [];
}

export function saveAdhocChecklists(checklists: ChecklistDef[], editorName: string | null) {
    return saveSetting(adhocKey, { checklists }, editorName);
}

// The checklists that are a fixed part of the pit flow. Until a lead edits
// one, it's a suggested checklist with its roles matched by name to the
// current roster.
export async function getFlowChecklist(id: FlowChecklistId): Promise<ChecklistDef> {
    return (await getSetting<ChecklistDef>(flowChecklistKeys[id])) ?? defaultFlowChecklist(id, await getPitRoles());
}

export function saveFlowChecklist(id: FlowChecklistId, checklist: ChecklistDef, editorName: string | null) {
    return saveSetting(flowChecklistKeys[id], { ...checklist, id }, editorName);
}

export const getPracticeChecklist = () => getFlowChecklist(practiceChecklistId);
export const getStartOfDayChecklist = () => getFlowChecklist(startOfDayChecklistId);
export const getEndOfDayChecklist = () => getFlowChecklist(endOfDayChecklistId);

export function defaultFlowChecklist(id: FlowChecklistId, roles: PitRole[]): ChecklistDef {
    const byName = new Map(roles.map((r) => [r.name.trim().toLowerCase(), r.id]));
    const ids = (...names: string[]) => names.map((n) => byName.get(n.toLowerCase())).filter((roleId): roleId is string => !!roleId);
    const step = (key: string, title: string, instructions: string, roleNames: string[], extra: Partial<ChecklistStep> = {}): ChecklistStep => ({
        // Stable ids, so reading the default twice gives the same checklist.
        id: `${id}-${key}`,
        title,
        instructions,
        role_ids: ids(...roleNames),
        condition: null,
        input: 'check',
        ...extra
    });

    if (id === practiceChecklistId) {
        return {
            id,
            name: 'Practice field',
            match_link: 'none',
            steps: [
                step('battery', 'Swap in a charged battery', 'Put in the next charged battery and record which one it is.', ['Battery'], { input: 'battery' }),
                step(
                    'bumpers',
                    'Bumpers installed',
                    "Either color is fine for the practice field. If the next match is the other color, swapping now saves doing it before the match.",
                    ['Mechanical', 'Drive Team'],
                    { condition: 'bumper_hint' }
                ),
                step('spool', 'Spool packed', 'Tether spool packed and going with the robot.', ['Programming']),
                step('driver-station', 'Driver station ready', 'Laptop charged, controllers plugged in, and the right code deployed.', ['Programming'])
            ]
        };
    }

    if (id === startOfDayChecklistId) {
        return {
            id,
            name: 'Start of day',
            match_link: 'none',
            steps: [
                step('mechanical', 'Robot mechanical inspection', 'Overall walk-around: frame, mechanisms, and anything worked on last night.', ['Mechanical']),
                step('fasteners', 'Fastener inspection', 'Check the paint-pen marks on critical bolts; re-torque any that moved.', ['Mechanical']),
                step('electrical', 'Electrical inspection', 'Wiring secure, no pinched or chafed wires, connectors seated.', ['Electrical']),
                step('breaker', 'Main breaker verification', 'Breaker firmly mounted, terminals tight, cover in place.', ['Electrical']),
                step('radio', 'Radio / network verification', 'Radio powered and configured for this event; robot connects.', ['Programming'], { input: 'pass_fail' }),
                step('driver-station', 'Driver Station verification', 'Laptop charged, controllers recognized, dashboard and code version correct.', ['Drive Team', 'Programming'], { input: 'pass_fail' }),
                step('vision', 'Vision system verification', 'Cameras connected and seeing targets; pipelines correct for this field.', ['Programming'], { input: 'pass_fail' }),
                step('charging', 'Battery charging equipment inspection', 'Chargers on, every battery charging or charged, no damaged leads.', ['Battery']),
                step('spares', 'Spare parts and tools verification', 'Spares bins stocked, tools back in place, consumables topped up.', ['Pit Lead'])
            ]
        };
    }

    return {
        id,
        name: 'End of day',
        match_link: 'none',
        steps: [
            step('repairs', 'Review open repairs', "Anything still open goes on tomorrow's list. Log what isn't logged yet.", ['Pit Lead']),
            step('batteries', 'Batteries on chargers', 'Every battery on a charger, including the one that was in the robot.', ['Battery']),
            step('power-down', 'Robot powered down', 'Main breaker off. Battery out of the robot.', ['Electrical']),
            step('laptops', 'Driver station and laptops charging', 'Plugged in, or packed to go back to the hotel.', ['Programming', 'Drive Team']),
            step('tools', 'Tools and spares put away', 'Tools back in their places; restock list written for anything used up.', ['Mechanical']),
            step('pit', 'Pit tidy and secured', 'Floor clear, valuables packed or locked, robot covered.', ['Pit Lead']),
            step('tomorrow', "Confirm tomorrow's first match", 'First match time and when the pit opens. Tell the team.', ['Pit Lead'])
        ]
    };
}

export function newId(): string {
    return crypto.randomUUID();
}

export function newStep(title = ''): ChecklistStep {
    return { id: newId(), title, instructions: '', role_ids: [], condition: null, input: 'check' };
}

// Steps from the suggested checklists as they were before steps could record
// anything. A pit that loaded those keeps them as saved, so these still record
// the battery (with the recommendation) without anyone re-editing the step.
// Choosing a "Records" value on Pit setup overrides this.
const legacyBatterySteps = ['record battery number'];

export function stepInput(step: ChecklistStep): StepInput {
    if (step.input) return step.input;
    return legacyBatterySteps.includes(step.title.trim().toLowerCase()) ? 'battery' : 'check';
}

// The checklist to resume at after repairs: the one flagged pre-match, or
// the last checklist when none is flagged.
export function prematchIndex(sequence: ChecklistSequence): number {
    const flagged = sequence.checklists.findIndex((c) => c.prematch);
    return flagged >= 0 ? flagged : sequence.checklists.length - 1;
}

// In the pit sequence, everything before the pre-match checklist is about the
// match just played; the pre-match checklist and anything after it are about
// the next one. Ad-hoc checklists aren't tied to a match unless set.
export function sequenceMatchLink(sequence: ChecklistSequence, index: number): MatchLink {
    const checklist = sequence.checklists[index];
    if (checklist?.match_link) return checklist.match_link;
    return index >= prematchIndex(sequence) ? 'next' : 'last';
}

// The roles every pit is expected to have. Pit setup offers any that are
// missing from the roster, so a pit set up before a role was added here can
// pick it up without reloading the defaults.
export const suggestedRoleNames = ['Pit Lead', 'Mechanical', 'Electrical', 'Programming', 'Battery', 'Drive Team'];

// Starter roles and checklists based on the requirements doc (§4.1), so leads
// can edit rather than type everything from scratch.
export function defaultPitSetup(): { roles: PitRole[]; sequence: ChecklistSequence; adhoc: ChecklistDef[] } {
    const role = (name: string): PitRole => ({ id: newId(), name, assignee: '' });
    // Keep these names in step with suggestedRoleNames.
    const roles = {
        lead: role('Pit Lead'),
        mech: role('Mechanical'),
        elec: role('Electrical'),
        prog: role('Programming'),
        battery: role('Battery'),
        drive: role('Drive Team')
    };
    const step = (
        title: string,
        instructions: string,
        roleList: PitRole[],
        options: { condition?: StepCondition; input?: StepInput } = {}
    ): ChecklistStep => ({
        id: newId(),
        title,
        instructions,
        role_ids: roleList.map((r) => r.id),
        condition: options.condition ?? null,
        input: options.input ?? 'check'
    });
    return {
        roles: Object.values(roles),
        sequence: {
            checklists: [
                {
                    id: newId(),
                    name: 'Post-match',
                    steps: [
                        step('Record driver / operator feedback', 'Ask the drive team what felt off: mechanisms, controls, brownouts, anything new.', [roles.drive, roles.lead], { input: 'text' }),
                        step('Visual damage inspection', 'Walk around the robot. Look for bent or cracked parts, loose wires, and debris.', [roles.mech]),
                        step('Check critical fasteners', 'Check the critical bolts with the paint-pen marks and re-torque any that moved.', [roles.mech]),
                        step('Inspect drivetrain', 'Spin each wheel by hand. Check modules, belts or chains, and wheel tread.', [roles.mech]),
                        step('Inspect mechanisms', 'Run each mechanism by hand through its travel. Check for binding, slop, and damage.', [roles.mech]),
                        step('Check electrical connections', 'Tug-test connectors on the PDH, motor controllers, and radio. Check the main breaker.', [roles.elec]),
                        step('Offload robot logs', 'Pull the logs off the robot and note which match they belong to.', [roles.prog]),
                        step('Review diagnostic warnings', 'Check the driver station and logs for faults, brownouts, and CAN errors from the match.', [roles.prog, roles.elec], { input: 'pass_fail' }),
                        step('Record repairs needed', 'Use "Log a repair for later" for anything that needs fixing before the next match.', [roles.lead]),
                        step(
                            'Post-match system check',
                            'Power on and run every mechanism through its full range (drive, intake, shooter, climber). Listen and watch for grinding, binding, slipping, or anything that broke. If something is broken, hit Repairs.',
                            [roles.mech, roles.elec, roles.drive],
                            { input: 'pass_fail' }
                        )
                    ]
                },
                {
                    id: newId(),
                    name: 'Pre-match',
                    prematch: true,
                    steps: [
                        step('Install the assigned battery', 'Put in the next charged battery and record which one it is. The used one goes on the charger.', [roles.battery], { input: 'battery' }),
                        step('Verify battery condition', 'Fully charged, terminals tight, no swelling or damage, strapped in.', [roles.battery], { input: 'pass_fail' }),
                        step(
                            'Swap bumpers',
                            "Switch the bumpers to the next match's alliance color. Skipped automatically when the color doesn't change.",
                            [roles.mech, roles.drive],
                            { condition: 'bumper_swap' }
                        ),
                        step('Bumpers attached, correct color', 'Check the alliance color for the next match and that the bumpers are secure.', [roles.mech, roles.drive]),
                        step('Verify robot configuration', 'Starting configuration, pre-loaded game pieces, and autonomous selection for this match.', [roles.drive, roles.prog]),
                        step('Subsystem checks', 'Power on with no faults on the driver station. Run each subsystem briefly.', [roles.elec, roles.mech], { input: 'pass_fail' }),
                        step('Verify critical sensor states', 'Encoders zeroed, limit switches reading correctly, gyro and vision alive.', [roles.prog, roles.elec], { input: 'pass_fail' }),
                        step('Driver station connects', 'Tether, enable, and confirm all subsystems respond.', [roles.drive, roles.prog], { input: 'pass_fail' }),
                        step('Confirm robot ready', 'Everything above is done and nothing is open on the repair list.', [roles.lead]),
                        step('Release robot to queue', 'Cart, battery, bumpers, and driver station all go with the robot.', [roles.lead])
                    ]
                }
            ]
        },
        adhoc: [
            {
                id: newId(),
                name: 'Bumper swap',
                match_link: 'between',
                steps: [
                    step('Remove bumpers', 'Unlatch and remove both bumper halves.', [roles.mech, roles.drive]),
                    step('Install the other color', "Fit the bumpers for the next match's alliance and latch every mount.", [roles.mech, roles.drive]),
                    step('Bumpers secure, correct color', 'Tug each corner. Confirm the color against the schedule.', [roles.lead], { input: 'pass_fail' })
                ]
            },
            {
                id: newId(),
                name: 'Subsystem deep dive',
                match_link: 'none',
                steps: [
                    step('What are we looking at?', 'Name the subsystem and what prompted the deep dive.', [roles.lead], { input: 'text' }),
                    step('Mechanical inspection', 'Fasteners, bearings, belts or chains, alignment, and wear.', [roles.mech], { input: 'pass_fail' }),
                    step('Electrical inspection', 'Motor and sensor wiring, connectors, and controller status lights.', [roles.elec], { input: 'pass_fail' }),
                    step('Functional test', 'Run it through its full range under power. Compare against how it normally behaves.', [roles.mech, roles.elec], { input: 'pass_fail' }),
                    step('Findings', 'What was found and what was done. Log a repair for anything still open.', [roles.lead], { input: 'text' })
                ]
            }
        ]
    };
}
