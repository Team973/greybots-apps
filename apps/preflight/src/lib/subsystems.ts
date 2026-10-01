// Suggestions for the free-text "subsystem" and "robot" links on notes and
// repairs (requirements §6.2). They're only suggestions: anything can be
// typed, so a new robot's subsystems need no software change.

export const subsystemSuggestions = [
    'Drivetrain',
    'Intake',
    'Shooter',
    'Climber',
    'Elevator',
    'Arm',
    'Electrical',
    'Pneumatics',
    'Controls / software',
    'Vision',
    'Bumpers',
    'Driver station'
];

export const robotSuggestions = ['Competition robot', 'Practice robot'];

// The suggestions plus whatever has been typed before, deduplicated.
export function withUsed(suggestions: string[], used: (string | null | undefined)[]): string[] {
    const all = new Map<string, string>();
    for (const value of [...suggestions, ...used]) {
        const trimmed = value?.trim();
        if (trimmed && !all.has(trimmed.toLowerCase())) all.set(trimmed.toLowerCase(), trimmed);
    }
    return [...all.values()];
}
