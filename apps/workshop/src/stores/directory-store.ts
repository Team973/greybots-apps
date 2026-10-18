import { defineStore } from 'pinia';
import { hasAppAccess, type AppRole } from '@greybots/common/lib/user-roles';
import { supabase } from '@greybots/common/supabase/client';
import { check, unwrap } from '@/lib/db';

// The things nearly every page needs to put names on ids: the people, the
// components (parts of the team), and the milestones. Loaded once after
// sign-in, and reloaded by the pages that change them.

export interface Person {
    user_id: string;
    name: string;
    role: AppRole;
}

export interface Component {
    id: string;
    name: string;
    color: string | null;
    sort_order: number;
    archived: boolean;
}

export interface Milestone {
    id: string;
    name: string;
    description: string;
    target_date: string | null;
    closed_at: string | null;
    created_at: string;
}

export const useDirectoryStore = defineStore('directory', {
    state() {
        return {
            people: [] as Person[],
            components: [] as Component[],
            milestones: [] as Milestone[],
            loaded: false
        };
    },
    getters: {
        // People who can be given a ticket: anyone with a Workshop role.
        assignable(): Person[] {
            return this.people.filter((p) => hasAppAccess(p.role));
        },
        activeComponents(): Component[] {
            return this.components.filter((c) => !c.archived);
        },
        openMilestones(): Milestone[] {
            return this.milestones.filter((m) => !m.closed_at);
        }
    },
    actions: {
        personName(id: string | null | undefined): string {
            if (!id) return 'Nobody';
            return this.people.find((p) => p.user_id === id)?.name ?? 'Someone';
        },
        component(id: string): Component | undefined {
            return this.components.find((c) => c.id === id);
        },
        milestone(id: string | null | undefined): Milestone | undefined {
            return id ? this.milestones.find((m) => m.id === id) : undefined;
        },

        async load() {
            await Promise.all([this.loadPeople(), this.loadComponents(), this.loadMilestones()]);
            this.loaded = true;
        },
        async ensureLoaded() {
            if (!this.loaded) await this.load();
        },

        async loadPeople() {
            const rows = unwrap(await supabase.from('User').select('user_id, name, workshop_role, deactivated')) as {
                user_id: string;
                name: string | null;
                workshop_role: AppRole | null;
                deactivated: boolean;
            }[];
            this.people = rows
                .map((r) => ({ user_id: r.user_id, name: r.name || 'Unnamed', role: r.deactivated ? 'deactivated' : r.workshop_role ?? 'pending' }) as Person)
                .sort((a, b) => a.name.localeCompare(b.name));
        },
        async loadComponents() {
            this.components = unwrap(await supabase.from('WorkshopComponent').select('*').order('sort_order').order('name')) as Component[];
        },
        async loadMilestones() {
            this.milestones = unwrap(
                await supabase.from('WorkshopMilestone').select('*').order('target_date', { ascending: true, nullsFirst: false }).order('created_at')
            ) as Milestone[];
        },

        // --- Components (leads and admins) ---
        async addComponent(name: string, color: string | null) {
            const sort_order = Math.max(0, ...this.components.map((c) => c.sort_order)) + 1;
            check(await supabase.from('WorkshopComponent').insert({ name: name.trim(), color, sort_order }));
            await this.loadComponents();
        },
        async updateComponent(id: string, changes: Partial<Pick<Component, 'name' | 'color' | 'archived' | 'sort_order'>>) {
            check(await supabase.from('WorkshopComponent').update(changes).eq('id', id));
            await this.loadComponents();
        },

        // --- Milestones (leads and admins) ---
        async saveMilestone(milestone: Partial<Milestone> & { name: string }): Promise<string> {
            const fields = {
                name: milestone.name.trim(),
                description: milestone.description ?? '',
                target_date: milestone.target_date || null,
                closed_at: milestone.closed_at ?? null
            };
            let id = milestone.id;
            if (id) {
                check(await supabase.from('WorkshopMilestone').update(fields).eq('id', id));
            } else {
                id = (unwrap(await supabase.from('WorkshopMilestone').insert(fields).select('id').single()) as { id: string }).id;
            }
            await this.loadMilestones();
            return id;
        },
        async deleteMilestone(id: string) {
            check(await supabase.from('WorkshopMilestone').delete().eq('id', id));
            await this.loadMilestones();
        }
    }
});
