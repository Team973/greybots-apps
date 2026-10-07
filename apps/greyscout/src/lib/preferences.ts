// @ts-nocheck
// Per-user preferences (issue #123). Kept in localStorage, so they're
// remembered per device rather than following the account, and they work
// offline. Same try/catch load/save pattern as tba-cache.ts.

const preferencesKey = 'greyscout_preferences';

export type AllianceEntry = 'drag' | 'type';
export type AlliancePoolOrder = 'tba' | 'picklist' | 'smart';

export interface Preferences {
    // How teams are put on alliances on the Playoffs page: dragged from the
    // pool, or by typing a team number into an alliance.
    allianceEntry: AllianceEntry;
    // How the Playoffs page orders the available teams.
    alliancePoolOrder: AlliancePoolOrder;
}

export const defaultPreferences: Preferences = {
    allianceEntry: 'drag',
    alliancePoolOrder: 'tba'
};

export const allianceEntryChoices = [
    { key: 'drag', text: 'Drag and drop' },
    { key: 'type', text: 'Type team numbers' }
];

export function loadPreferences(): Preferences {
    try {
        const raw = localStorage.getItem(preferencesKey);
        const saved = raw ? JSON.parse(raw) : {};
        const preferences = { ...defaultPreferences };
        if (saved.allianceEntry === 'drag' || saved.allianceEntry === 'type') preferences.allianceEntry = saved.allianceEntry;
        if (['tba', 'picklist', 'smart'].includes(saved.alliancePoolOrder)) preferences.alliancePoolOrder = saved.alliancePoolOrder;
        return preferences;
    } catch {
        return { ...defaultPreferences };
    }
}

export function savePreferences(changes: Partial<Preferences>): Preferences {
    const preferences = { ...loadPreferences(), ...changes };
    try {
        localStorage.setItem(preferencesKey, JSON.stringify(preferences));
    } catch (e) {
        console.warn('Failed to save preferences:', e);
    }
    return preferences;
}
