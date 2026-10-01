import { getSetting, saveSetting } from '@/lib/settings';

// Quick-create options for common repairs (issue #83): one tap fills in what
// is being repaired and its subsystem. The list is a shared setting that
// leads edit on Pit setup, so it can follow this year's robot with no
// software change.

export interface RepairPreset {
    id: string;
    title: string;
    subsystem: string;
}

const presetsKey = 'repair_presets';

// Used until a lead saves their own list. (Stable ids, so reading the
// defaults twice gives the same list.)
export function defaultRepairPresets(): RepairPreset[] {
    const defaults: [title: string, subsystem: string][] = [
        // Kept short: they're shown as chips, and should fit in three rows.
        ['Swap swerve module', 'Drivetrain'],
        ['Replace wheel tread', 'Drivetrain'],
        ['Re-zero encoders', 'Drivetrain'],
        ['Tighten fasteners', ''],
        ['Replace belt / chain', ''],
        ['Fix loose wiring', 'Electrical'],
        ['Replace motor', 'Electrical'],
        ['Repair bumper', 'Bumpers'],
        ['Re-seat radio', 'Electrical'],
        ['Redeploy code', 'Controls / software']
    ];
    return defaults.map(([title, subsystem], i) => ({ id: `default-${i}`, title, subsystem }));
}

// Null (never configured) gives the defaults; a saved empty list means the
// team wants no presets.
export async function getRepairPresets(): Promise<RepairPreset[]> {
    const saved = await getSetting<{ presets: RepairPreset[] }>(presetsKey);
    return saved?.presets ?? defaultRepairPresets();
}

export function saveRepairPresets(presets: RepairPreset[], editorName: string | null) {
    return saveSetting(presetsKey, { presets }, editorName);
}
