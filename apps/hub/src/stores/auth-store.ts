import { defineStore } from 'pinia';
import { ensureUserProfile } from '@greybots/common/lib/account';
import { accountStatus, type AccountStatus, type UserAccount } from '@greybots/common/lib/user-roles';
import { supabase } from '@greybots/common/supabase/client';

// Who's signed in to the hub: the same greybots-apps account every app uses,
// and its profile (name, and role in each app).
export const useAuthStore = defineStore('auth', {
    state() {
        return {
            userId: null as string | null,
            email: null as string | null,
            profile: null as UserAccount | null,
            // False until the first check has finished.
            loaded: false
        };
    },
    getters: {
        isSignedIn(): boolean {
            return !!this.userId;
        },
        name(): string {
            return this.profile?.name || this.email || 'Unknown user';
        },
        // Pending (no role in any app yet), active, or deactivated. An account
        // whose profile couldn't be read is treated as pending.
        status(): AccountStatus {
            return this.profile ? accountStatus(this.profile) : 'pending';
        },
        // Signed in with a role in at least one app.
        hasAccess(): boolean {
            return this.isSignedIn && this.status === 'active';
        }
    },
    actions: {
        // Read the session on this device and the account's profile. Called at
        // startup, and again whenever the account may have changed.
        async refresh() {
            const { data } = await supabase.auth.getSession();
            const user = data.session?.user ?? null;
            this.userId = user?.id ?? null;
            this.email = user?.email ?? null;
            try {
                this.profile = user ? await ensureUserProfile(user) : null;
            } catch {
                // Offline or unreachable: keep whatever profile we had.
                if (!user) this.profile = null;
            } finally {
                this.loaded = true;
            }
        },

        async signIn(email: string, password: string) {
            const { error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) throw new Error(error.message);
            await this.refresh();
        },

        async signOut() {
            await supabase.auth.signOut({ scope: 'local' });
            await this.refresh();
        }
    }
});
