import { milestonePhases, type MilestonePhase } from '@/lib/schedule/types';
import { getSetting, saveSetting } from '@/lib/settings';

// Pit display configuration (issue #90): which widgets the big screen shows
// above the robot status, per event phase. Stored as a shared setting, so a
// lead can change it from any device and the screen follows.

export type DisplayWidget =
    | 'next_match'
    | 'countdown'
    | 'readiness'
    | 'current_match'
    | 'checklist'
    | 'repair'
    | 'battery'
    | 'roles'
    | 'phase'
    | 'timer';

// In the order they're offered in the editor.
export const displayWidgets: DisplayWidget[] = [
    'next_match',
    'countdown',
    'readiness',
    'current_match',
    'checklist',
    'repair',
    'battery',
    'roles',
    'phase',
    'timer'
];

export const displayWidgetLabels: Record<DisplayWidget, string> = {
    next_match: 'Next match',
    countdown: 'Countdown (to queue, then to the match)',
    readiness: 'Readiness (prep and queue deadlines)',
    current_match: 'Current match',
    checklist: 'Active checklist',
    repair: 'Active repair',
    battery: 'Battery installed',
    roles: 'Pit responsibilities',
    phase: 'Event phase',
    timer: 'Timer (the pit timer from the Overview)'
};

// A layout per event phase, plus 'default' for when the phase isn't known
// (no milestones on the timeline yet).
export type DisplayPhase = MilestonePhase | 'default';
export const displayPhases: DisplayPhase[] = ['default', ...milestonePhases];

export interface DisplayConfig {
    layouts: Record<DisplayPhase, DisplayWidget[]>;
    // Show this phase's layout instead of following the timeline.
    phase_override: DisplayPhase | null;
    // Bumped when a widget is added to the default layouts, so a config saved
    // before then picks it up once (see getDisplayConfig).
    version?: number;
}

const configVersion = 2;

const matchDay: DisplayWidget[] = ['next_match', 'countdown', 'readiness', 'checklist', 'repair', 'battery', 'timer'];

export function defaultDisplayConfig(): DisplayConfig {
    return {
        layouts: {
            default: [...matchDay],
            prep: ['phase', 'checklist', 'repair', 'roles', 'battery'],
            competition: [...matchDay],
            elimination: ['current_match', 'next_match', 'countdown', 'readiness', 'checklist', 'repair', 'battery', 'timer'],
            closeout: ['phase', 'roles', 'repair']
        },
        phase_override: null,
        version: configVersion
    };
}

const displayKey = 'pit_display';

export async function getDisplayConfig(): Promise<DisplayConfig> {
    const saved = await getSetting<Partial<DisplayConfig>>(displayKey);
    const defaults = defaultDisplayConfig();
    // Tolerate a config saved before a phase or widget existed.
    const layouts = { ...defaults.layouts };
    for (const phase of displayPhases) {
        const list = saved?.layouts?.[phase];
        if (!Array.isArray(list)) continue;
        layouts[phase] = list.filter((w) => displayWidgets.includes(w));
        // Version 2 added the timer: a layout saved before then gets it where
        // the default has it. After that, removing it sticks.
        if ((saved?.version ?? 1) < 2 && defaults.layouts[phase].includes('timer') && !layouts[phase].includes('timer')) {
            layouts[phase] = [...layouts[phase], 'timer'];
        }
    }
    return { layouts, phase_override: saved?.phase_override ?? null, version: configVersion };
}

export function saveDisplayConfig(config: DisplayConfig, editorName: string | null) {
    return saveSetting(displayKey, config, editorName);
}

// The layout to show: the overridden phase's, else the current phase's, else
// the default.
export function activeLayout(config: DisplayConfig, phase: MilestonePhase | null): { phase: DisplayPhase; widgets: DisplayWidget[] } {
    const key: DisplayPhase = config.phase_override ?? phase ?? 'default';
    return { phase: key, widgets: config.layouts[key] ?? config.layouts.default };
}
