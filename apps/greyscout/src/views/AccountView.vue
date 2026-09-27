<script setup lang="ts">
// TODO: fix types
// @ts-nocheck

import "@material/web/button/filled-button";
import TextInput from '@greybots/common/components/TextInput.vue';
import SearchableDropdown from '@greybots/common/components/SearchableDropdown.vue';

import { supabase } from "@greybots/common/supabase/client";

import { useAuthStore, roleRank } from "@/stores/auth-store";
import { useEventStore } from "@/stores/event-store";
import { fetchAllUsers, updateUserRole } from "@/lib/user-query";
import { refreshEventSchedule } from "@/lib/tba-query";
</script>

<template>
    <div class="main-content">
        <div class="user-tile">
            <h1>Profile</h1>
            <div>Name: {{ authStore.currentUserName || '(no name on file)' }}</div>
            <div>Role: {{ authStore.role }}</div>
        </div>

        <div class="user-tile" v-if="authStore.isLead">
            <h1>Event Management</h1>
            <div>Current event: {{ eventStore.eventName || eventStore.eventId }}</div>
            <md-filled-button v-on:click="refreshEventData" :disabled="eventRefreshing" class="load-button">
                {{ eventRefreshing ? 'Refreshing…' : 'Refresh Event Data' }}
            </md-filled-button>
            <p v-if="eventRefreshMessage" class="event-refresh-message">{{ eventRefreshMessage }}</p>
            <p v-if="eventRefreshError" class="form-error">{{ eventRefreshError }}</p>
        </div>

        <div class="user-tile">
            <h1>People</h1>
            <div v-if="!peopleLoaded">Loading people…</div>
            <div v-else-if="people.length === 0">No other users found.</div>
            <table v-else class="people-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Role</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="person in people" :key="person.user_id">
                        <td>{{ person.name || 'Unnamed user' }}</td>
                        <td class="people-role">{{ person.role }}</td>
                        <td>
                            <SearchableDropdown
                                v-if="person.user_id !== authStore.currentUserId && allowedRoles(person.role).length > 0"
                                class="role-select" :choices="roleChoices(person.role)"
                                :model-value="pendingRole[person.user_id] || ''" placeholder="Change role…"
                                @update:modelValue="changeRole(person, $event)"></SearchableDropdown>
                        </td>
                    </tr>
                </tbody>
            </table>
            <p v-if="peopleError" class="form-error">{{ peopleError }}</p>
        </div>

        <div class="user-tile">
            <h1>Log Out</h1>
            <md-filled-button v-on:click="logOutUser()" class="load-button">Log out</md-filled-button>
        </div>
    </div>
</template>

<script lang="ts">
const ALL_ROLES = ['observer', 'member', 'lead', 'admin'];

export default {
    data() {
        return {
            authStore: null,
            eventStore: null,
            people: [],
            peopleLoaded: false,
            peopleError: "",
            pendingRole: {},
            eventRefreshing: false,
            eventRefreshMessage: "",
            eventRefreshError: "",
        }
    },
    methods: {
        async refreshEventData() {
            this.eventRefreshing = true;
            this.eventRefreshMessage = "";
            this.eventRefreshError = "";

            const { matchCount, error } = await refreshEventSchedule(this.eventStore.eventId);

            if (error) {
                this.eventRefreshError = error.message;
            } else {
                this.eventRefreshMessage = `Match schedule refreshed — ${matchCount} matches.`;
            }

            this.eventRefreshing = false;
        },
        async loadPeople() {
            this.peopleLoaded = false;
            this.people = await fetchAllUsers();
            this.peopleLoaded = true;
        },
        roleChoices(targetRole) {
            return this.allowedRoles(targetRole).map((r) => ({ key: r, text: r }));
        },
        allowedRoles(targetRole) {
            const actorRank = roleRank[this.authStore.role] ?? -1;
            const oldRank = roleRank[targetRole] ?? -1;

            return ALL_ROLES.filter((candidate) => {
                const newRank = roleRank[candidate];
                if (newRank === oldRank) return false;
                if (newRank > oldRank) {
                    // Promotion: must outrank the target's current role, and cannot
                    // grant a role higher than the actor's own.
                    return actorRank > oldRank && newRank <= actorRank;
                }
                // Relegation (demotion) is admin-only.
                return this.authStore.role === 'admin';
            });
        },
        async changeRole(person, newRole) {
            if (!newRole) return;
            this.peopleError = "";
            const previousRole = person.role;
            this.pendingRole[person.user_id] = newRole;

            const error = await updateUserRole(person.user_id, newRole);

            if (error) {
                this.peopleError = error.message ?? 'Unable to update role.';
                this.pendingRole[person.user_id] = previousRole;
                return;
            }

            person.role = newRole;
            this.pendingRole[person.user_id] = '';
        },
        async logOutUser() {
            const { error } = await supabase.auth.signOut();

            if (error) {
                // TODO
                return;
            }

            this.authStore.checkUser();
            this.$router.push("/event");
        }
    },
    async created() {
        this.authStore = useAuthStore();
        this.eventStore = useEventStore();
        await this.authStore.checkUser();
        await this.eventStore.updateEvent();
        await this.loadPeople();
    }
}
</script>

<style scoped>
.user-tile {
    margin-bottom: 20px;
}

.people-table {
    border-collapse: collapse;
    width: 100%;
}

.people-table th,
.people-table td {
    text-align: left;
    padding: 8px 12px;
    border-bottom: 1px solid rgba(128, 128, 128, 0.2);
}

.people-role {
    text-transform: capitalize;
}

.form-error {
    color: #c0392b;
}

.event-refresh-message {
    color: #2f8a2f;
    font-size: 13px;
}

.role-select {
    display: block;
    min-width: 160px;
}
</style>
