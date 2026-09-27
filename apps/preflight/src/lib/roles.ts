// Same role ladder as the greybots-apps `User` table, so web-mode accounts
// and kiosk-mode local users can be permission-checked the same way.
export type Role = 'admin' | 'lead' | 'member' | 'observer';

// Kiosk users are created by a device admin, so they never need 'observer'.
export type KioskRole = Exclude<Role, 'observer'>;
export const kioskRoles: KioskRole[] = ['admin', 'lead', 'member'];

export const roleRank: Record<Role, number> = {
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
