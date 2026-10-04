import { defineStore } from 'pinia';
import { supabase } from '@greybots/common/supabase/client';
import { db, getMeta, setMeta, deleteMeta } from '@/lib/db';
import { kioskSessionKey } from '@/lib/constants';
import { verifyKioskPin } from '@/lib/kiosk-users';
import { fetchAccountProfile, signInAccount, signOutAccount, type AccountProfile } from '@/lib/greybots-account';
import { hasRole, type Role } from '@/lib/roles';
import { useDeviceStore } from './device-store';

// Whoever is using the app right now, regardless of how they signed in.
export interface SessionUser {
    id: string;
    name: string;
    role: Role;
    source: 'kiosk' | 'web';
}

// Last-known profile for the web-mode account, so a signed-in user can keep
// working (with the right name/role) while offline.
const webProfileKey = 'web_profile';

function fromProfile(profile: AccountProfile): SessionUser {
    return { id: profile.id, name: profile.name, role: profile.role, source: 'web' };
}

export const useSessionStore = defineStore('session', {
    state() {
        return {
            user: null as SessionUser | null
        };
    },
    getters: {
        isSignedIn(): boolean {
            return !!this.user;
        },
        hasRole() {
            return (minRole: Role) => hasRole(this.user?.role, minRole);
        }
    },
    actions: {
        // Called once at startup, before the router's first navigation.
        async restore() {
            const device = useDeviceStore();
            if (device.mode === 'kiosk') {
                const userId = sessionStorage.getItem(kioskSessionKey);
                const kioskUser = userId ? await db.kioskUsers.get(userId) : undefined;
                this.user = kioskUser
                    ? { id: kioskUser.id, name: kioskUser.name, role: kioskUser.role, source: 'kiosk' }
                    : null;
            } else if (device.mode === 'web') {
                // getSession() reads local storage only — no network needed.
                const { data } = await supabase.auth.getSession();
                const authUser = data.session?.user;
                if (!authUser) {
                    this.user = null;
                    return;
                }
                const cached = await getMeta<AccountProfile>(webProfileKey);
                this.user = cached?.id === authUser.id
                    ? fromProfile(cached)
                    : { id: authUser.id, name: authUser.email ?? 'Unknown user', role: 'pending', source: 'web' };
                // Pick up name/role changes when we're online; ignore failures offline.
                this.refreshWebProfile().catch(() => undefined);
            }
        },

        async refreshWebProfile() {
            if (this.user?.source !== 'web') return;
            const { data } = await supabase.auth.getSession();
            const authUser = data.session?.user;
            if (!authUser) return;
            const profile = await fetchAccountProfile(authUser);
            await setMeta(webProfileKey, profile);
            this.user = fromProfile(profile);
        },

        // Take up the server session that's already on this device (someone
        // who just registered and was signed in straight away).
        async adoptWebSession() {
            const { data } = await supabase.auth.getSession();
            const authUser = data.session?.user;
            if (!authUser) return;
            const profile = await fetchAccountProfile(authUser);
            await setMeta(webProfileKey, profile);
            this.user = fromProfile(profile);
        },

        async signInKiosk(userId: string, pin: string): Promise<boolean> {
            const kioskUser = await verifyKioskPin(userId, pin);
            if (!kioskUser) return false;
            this.user = { id: kioskUser.id, name: kioskUser.name, role: kioskUser.role, source: 'kiosk' };
            sessionStorage.setItem(kioskSessionKey, kioskUser.id);
            return true;
        },

        async signInWeb(email: string, password: string) {
            const profile = await signInAccount(email, password);
            await setMeta(webProfileKey, profile);
            this.user = fromProfile(profile);
        },

        // Kiosk: just locks the device for the next person; the linked sync
        // account stays signed in. Web: signs the account out of this device.
        async signOut() {
            if (this.user?.source === 'web') {
                await signOutAccount();
                await deleteMeta(webProfileKey);
            }
            sessionStorage.removeItem(kioskSessionKey);
            this.user = null;
        },

        // Re-read the kiosk user after an admin edits them (e.g. role change).
        async reloadKioskUser() {
            if (this.user?.source !== 'kiosk') return;
            const kioskUser = await db.kioskUsers.get(this.user.id);
            if (!kioskUser) {
                await this.signOut();
                return;
            }
            this.user = { id: kioskUser.id, name: kioskUser.name, role: kioskUser.role, source: 'kiosk' };
        }
    }
});
