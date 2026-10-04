<script setup lang="ts">
// TODO: fix types
// @ts-nocheck

import "@material/web/button/filled-button";

import { supabase } from "@greybots/common/supabase/client";

import { useAuthStore } from "@/stores/auth-store";
import { useEventStore } from "@/stores/event-store";
import { refreshEventSchedule } from "@/lib/tba-query";
</script>

<template>
    <div class="main-content">
        <div class="user-tile">
            <h1>Profile</h1>
            <div>Name: {{ authStore.currentUserName || '(no name on file)' }}</div>
            <div>Scouting role: {{ authStore.role }}</div>
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
            <p>Everyone with an account, and their role in each greybots app.</p>
            <md-filled-button v-on:click="$router.push('/users')" class="load-button">Manage people</md-filled-button>
        </div>

        <div class="user-tile">
            <h1>Log Out</h1>
            <md-filled-button v-on:click="logOutUser()" class="load-button">Log out</md-filled-button>
        </div>
    </div>
</template>

<script lang="ts">
export default {
    data() {
        return {
            authStore: null,
            eventStore: null,
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
    }
}
</script>

<style scoped>
.user-tile {
    margin-bottom: 20px;
}

.form-error {
    color: #c0392b;
}

.event-refresh-message {
    color: #2f8a2f;
    font-size: 13px;
}
</style>
