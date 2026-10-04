// @ts-nocheck

import { defineStore } from 'pinia';
import { supabase } from '@greybots/common/supabase/client';
import { ensureUserProfile } from '@greybots/common/lib/account';
import { hasAppAccess } from '@greybots/common/lib/user-roles';
import { isSiteReadPrivate, isSiteWritePrivate } from '@/lib/constants';

// 'pending' (a new account nobody has approved yet) and 'deactivated' have no
// access to the app at all.
export type UserRole = 'admin' | 'lead' | 'member' | 'observer' | 'pending' | 'deactivated' | null;

export const roleRank: Record<Exclude<UserRole, null>, number> = {
    deactivated: -2,
    pending: -1,
    observer: 0,
    member: 1,
    lead: 2,
    admin: 3
};

export const useAuthStore = defineStore('auth', {
    state() {
        return {
            isLoggedIn: false,
            userId: null as string | null,
            userName: null as string | null,
            role: null as UserRole,
            isUpdated: false
        };
    },
    getters: {
        isUserLoggedIn(): boolean {
            return this.isLoggedIn;
        },
        isViewAuthorized(): boolean {
            return this.isLoggedIn || !isSiteReadPrivate;
        },
        isWriteAuthorized(): boolean {
            return (this.isLoggedIn && this.isMember) || !isSiteWritePrivate;
        },
        isLoaded(): boolean {
            return this.isUpdated;
        },
        // Role-based getters
        isAdmin(): boolean {
            return this.role === 'admin';
        },
        isLead(): boolean {
            return this.role === 'admin' || this.role === 'lead';
        },
        isMember(): boolean {
            return this.role === 'admin' || this.role === 'lead' || this.role === 'member';
        },
        isObserver(): boolean {
            return this.role === 'observer';
        },
        // Signed in with a role in this app (not pending or deactivated).
        hasAccess(): boolean {
            return this.isLoggedIn && hasAppAccess(this.role);
        },
        isDeactivated(): boolean {
            return this.role === 'deactivated';
        },
        currentUserId(): string | null {
            return this.userId;
        },
        currentUserName(): string | null {
            return this.userName;
        }
    },
    actions: {
        async checkUser() {
            this.isUpdated = false;

            const { data: { user }, error } = await supabase.auth.getUser();
            this.isLoggedIn = !error && !!user;

            if (error || !user) {
                this.role = null;
                this.userId = null;
                this.userName = null;
                this.isUpdated = true;
                return;
            }

            this.userId = user.id;

            // The profile row, provisioned the first time this user is seen
            // (shared with the other greybots apps). New accounts always
            // start out pending: a lead or admin has to give them a role.
            let profile = null;
            try {
                profile = await ensureUserProfile(user);
            } catch {
                this.role = 'observer';
                this.userName = null;
                this.isUpdated = true;
                return;
            }

            if (!profile) {
                // Insert failed (e.g. no active session yet while awaiting email confirmation).
                this.role = 'pending';
                this.userName = user.user_metadata?.name ?? null;
                this.isUpdated = true;
                return;
            }

            this.userName = profile.name ?? null;
            this.role = profile.role as UserRole;

            this.isUpdated = true;
        }
    }
});
