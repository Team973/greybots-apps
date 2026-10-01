import { milestonePhases, type MilestonePhase } from '@/lib/schedule/types';
import { getSetting, saveSetting } from '@/lib/settings';

// Pit display configuration (issue #90): which widgets the big screen shows
// under the robot status, per event phase. Stored as a shared setting, so a
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
    | 'phase';

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
    'phase'
];

export const displayWidgetLabels: Record<DisplayWidget, string> = {
    next_match: 'Next match',
    countdown: 'Countdown to next match',
    readiness: 'Readiness (prep and queue deadlines)',
    current_match: 'Current match',
    checklist: 'Active checklist',
    repair: 'Active repair',
    battery: 'Battery installed',
    roles: 'Pit responsibilities',
    phase: 'Event phase'
};

// A layout per event phase, plus 'default' for when the phase isn't known
// (no milestones on the timeline yet).
export type DisplayPhase = MilestonePhase | 'default';
export const displayPhases: DisplayPhase[] = ['default', ...milestonePhases];

export interface DisplayConfig {
    layouts: Record<DisplayPhase, DisplayWidget[]>;
    // Show this phase's layout instead of following the timeline.
    phase_override: DisplayPhase | null;
}

const matchDay: DisplayWidget[] = ['next_match', 'countdown', 'readiness', 'checklist', 'repair', 'battery'];

export function defaultDisplayConfig(): DisplayConfig {
    return {
        layouts: {
            default: [...matchDay],
            prep: ['phase', 'checklist', 'repair', 'roles', 'battery'],
            competition: [...matchDay],
            elimination: ['current_match', 'next_match', 'countdown', 'readiness', 'checklist', 'repair', 'battery'],
            closeout: ['phase', 'roles', 'repair']
        },
        phase_override: null
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
        if (Array.isArray(list)) layouts[phase] = list.filter((w) => displayWidgets.includes(w));
    }
    return { layouts, phase_override: saved?.phase_override ?? null };
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
