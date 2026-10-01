import { getSetting, saveSetting } from '@/lib/settings';

// Pit checklist configuration (issue #82), kept as shared settings that
// leads edit on the Pit setup page:
// - the pit roles roster: who currently does each job, and
// - one standard sequence of checklists that runs every time the robot
//   comes back to the pit.

export interface PitRole {
    id: string;
    name: string;
    // Free text, so it works for kiosk crew and web accounts alike.
    assignee: string;
}

export interface ChecklistStep {
    id: string;
    title: string;
    instructions: string;
    // PitRole ids involved in this step.
    role_ids: string[];
}

export interface ChecklistDef {
    id: string;
    name: string;
    steps: ChecklistStep[];
}

export interface ChecklistSequence {
    checklists: ChecklistDef[];
}

const pitRolesKey = 'pit_roles';
const sequenceKey = 'checklist_sequence';

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

export function newId(): string {
    return crypto.randomUUID();
}

export function newStep(title = ''): ChecklistStep {
    return { id: newId(), title, instructions: '', role_ids: [] };
}

// Starter roles and checklists based on the requirements doc (§4.1), so leads
// can edit rather than type everything from scratch.
export function defaultPitSetup(): { roles: PitRole[]; sequence: ChecklistSequence } {
    const role = (name: string): PitRole => ({ id: newId(), name, assignee: '' });
    const roles = {
        lead: role('Pit Lead'),
        mech: role('Mechanical'),
        elec: role('Electrical'),
        battery: role('Battery'),
        drive: role('Drive Team')
    };
    const step = (title: string, instructions: string, roleList: PitRole[]): ChecklistStep => ({
        id: newId(),
        title,
        instructions,
        role_ids: roleList.map((r) => r.id)
    });
    return {
        roles: Object.values(roles),
        sequence: {
            checklists: [
                {
                    id: newId(),
                    name: 'Post-match',
                    steps: [
                        step('Record driver feedback', 'Ask the drive team what felt off: mechanisms, controls, brownouts, anything new.', [roles.drive, roles.lead]),
                        step('Visual damage inspection', 'Walk around the robot. Look for bent or cracked parts, loose wires, and debris.', [roles.mech]),
                        step('Check critical fasteners', 'Check the critical bolts with the paint-pen marks and re-torque any that moved.', [roles.mech]),
                        step('Check electrical connections', 'Tug-test connectors on the PDH, motor controllers, and radio. Check the main breaker.', [roles.elec]),
                        step('Record repairs needed', 'Add a task for anything that needs fixing before the next match.', [roles.lead])
                    ]
                },
                {
                    id: newId(),
                    name: 'Battery swap',
                    steps: [
                        step('Swap in a charged battery', 'Install the next charged battery and put the used one on the charger.', [roles.battery]),
                        step('Record battery number', 'Note which battery is installed for this match.', [roles.battery])
                    ]
                },
                {
                    id: newId(),
                    name: 'Pre-match',
                    steps: [
                        step('Bumpers attached, correct color', 'Check the alliance color for the next match and that the bumpers are secure.', [roles.mech, roles.drive]),
                        step('Robot powers on cleanly', 'Power on and confirm no faults on the driver station.', [roles.elec]),
                        step('Driver station connects', 'Tether, enable, and confirm all subsystems respond.', [roles.drive, roles.elec]),
                        step('Ready for queue', 'Cart, battery, bumpers, and driver station all go with the robot.', [roles.lead])
                    ]
                }
            ]
        }
    };
}
