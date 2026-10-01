import { getPitRoles, type PitRole } from '@/lib/checklists/config';
import { getSetting, saveSetting } from '@/lib/settings';

// Quick-create options for common repairs (issue #83): one tap fills in what
// is being repaired, its subsystem, and who's on it. Each common repair
// belongs to a pit subteam (a pit role from Pit setup, e.g. Mechanical), and
// goes to whoever holds that role right now. The list is a shared setting
// that leads edit on Pit setup, so it can follow this year's robot with no
// software change.

export interface RepairPreset {
    id: string;
    title: string;
    subsystem: string;
    // The pit role (subteam) that does this repair. Absent or '' = none.
    role_id?: string;
}

const presetsKey = 'repair_presets';

// Used until a lead saves their own list. Subteams are matched by name to
// the current roster. (Stable ids, so reading the defaults twice gives the
// same list.)
export function defaultRepairPresets(roles: PitRole[] = []): RepairPreset[] {
    const defaults: [title: string, subsystem: string, subteam: string][] = [
        // Kept short: they're shown as chips, and should fit in three rows.
        ['Swap swerve module', 'Drivetrain', 'Mechanical'],
        ['Replace wheel tread', 'Drivetrain', 'Mechanical'],
        ['Re-zero encoders', 'Drivetrain', 'Programming'],
        ['Tighten fasteners', '', 'Mechanical'],
        ['Replace belt / chain', '', 'Mechanical'],
        ['Fix loose wiring', 'Electrical', 'Electrical'],
        ['Replace motor', 'Electrical', 'Electrical'],
        ['Repair bumper', 'Bumpers', 'Mechanical'],
        ['Re-seat radio', 'Electrical', 'Electrical'],
        ['Redeploy code', 'Controls / software', 'Programming']
    ];
    const byName = new Map(roles.map((r) => [r.name.trim().toLowerCase(), r.id]));
    return defaults.map(([title, subsystem, subteam], i) => ({
        id: `default-${i}`,
        title,
        subsystem,
        role_id: byName.get(subteam.toLowerCase()) ?? ''
    }));
}

// Null (never configured) gives the defaults; a saved empty list means the
// team wants no presets.
export async function getRepairPresets(): Promise<RepairPreset[]> {
    const saved = await getSetting<{ presets: RepairPreset[] }>(presetsKey);
    return saved?.presets ?? defaultRepairPresets(await getPitRoles());
}

export function saveRepairPresets(presets: RepairPreset[], editorName: string | null) {
    return saveSetting(presetsKey, { presets }, editorName);
}

// The subteam a common repair belongs to, if it still exists.
export function presetRole(preset: RepairPreset, roles: PitRole[]): PitRole | null {
    return roles.find((r) => r.id === preset.role_id) ?? null;
}

// Who a repair made from this preset goes to: whoever holds its subteam's
// role. '' when the repair has no subteam or the role has nobody assigned.
export function presetAssignee(preset: RepairPreset, roles: PitRole[]): string {
    return presetRole(preset, roles)?.assignee.trim() ?? '';
}
