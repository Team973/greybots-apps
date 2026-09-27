// @ts-nocheck

import { defineStore } from 'pinia';
import { supabase } from '@greybots/common/supabase/client';
import { userTable } from '@/lib/constants';
import { isSiteReadPrivate, isSiteWritePrivate } from '@/lib/constants';

export type UserRole = 'admin' | 'lead' | 'member' | 'observer' | null;

export const roleRank: Record<Exclude<UserRole, null>, number> = {
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

            const dbResponse = await supabase
                .from(userTable)
                .select()
                .eq('user_id', user.id);

            let dbData = dbResponse?.data;
            const dbError = dbResponse?.error;

            if (dbError) {
                this.role = 'observer';
                this.userName = null;
                this.isUpdated = true;
                return;
            }

            // First time this user has been seen — provision their profile row.
            // New accounts always start out as Observers.
            if (!dbData || dbData.length === 0) {
                const provisionedName = user.user_metadata?.name ?? null;
                const { data: insertedData } = await supabase
                    .from(userTable)
                    .insert({ user_id: user.id, name: provisionedName, role: 'observer' })
                    .select();
                dbData = insertedData;
            }

            if (!dbData || dbData.length === 0) {
                // Insert failed (e.g. no active session yet while awaiting email confirmation).
                this.role = 'observer';
                this.userName = user.user_metadata?.name ?? null;
                this.isUpdated = true;
                return;
            }

            this.userName = dbData[0].name ?? null;
            this.role = dbData[0].role as UserRole;

            this.isUpdated = true;
        }
    }
});
