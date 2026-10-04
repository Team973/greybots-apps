// Same role ladder as the greybots-apps `User` table, so web-mode accounts
// and kiosk-mode local users can be permission-checked the same way.
// 'pending' (a new account nobody has approved yet) and 'deactivated' have no
// access to the app at all.
export type Role = 'admin' | 'lead' | 'member' | 'observer' | 'pending' | 'deactivated';

// Kiosk users are created by a device admin, so they never need the roles
// below member.
export type KioskRole = Exclude<Role, 'observer' | 'pending' | 'deactivated'>;
export const kioskRoles: KioskRole[] = ['admin', 'lead', 'member'];

export const roleRank: Record<Role, number> = {
    deactivated: -2,
    pending: -1,
    observer: 0,
    member: 1,
    lead: 2,
    admin: 3
};

export function hasRole(role: Role | null | undefined, minRole: Role): boolean {
    return !!role && roleRank[role] >= roleRank[minRole];
}

export function roleLabel(role: Role): string {
    return role.charAt(0).toUpperCase() + role.slice(1);
}
