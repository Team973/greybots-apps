import type { AppRoleColumn } from '@greybots/common/lib/user-roles';

// The greybots apps the hub points to. Each one is its own deployment at its
// own address; the hub is the one address people need to remember.

export interface HubApp {
    key: string;
    name: string;
    description: string;
    url: string;
    // The `User` column holding a person's role in this app.
    roleColumn: AppRoleColumn['column'];
}

// "https://example.com/" -> "https://example.com"
const clean = (url: string) => url.trim().replace(/\/+$/, '');

// Override either address with VITE_GREYSCOUT_URL / VITE_PREFLIGHT_URL (in the
// deployment's environment, or a .env.local for development).
export const hubApps: HubApp[] = [
    {
        key: 'greyscout',
        name: 'GreyScout',
        description: 'Scouting, match strategy, and alliance selection',
        url: clean(import.meta.env.VITE_GREYSCOUT_URL || 'https://greyscout.vercel.app'),
        roleColumn: 'role'
    },
    {
        key: 'preflight',
        name: 'Preflight',
        description: 'Pit crew checklists, repairs, batteries, and schedule',
        url: clean(import.meta.env.VITE_PREFLIGHT_URL || 'https://greybots-preflight.vercel.app'),
        roleColumn: 'preflight_role'
    }
];
