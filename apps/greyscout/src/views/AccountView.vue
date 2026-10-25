<script setup lang="ts">
// TODO: fix types
// @ts-nocheck

import "@material/web/button/filled-button";

import { supabase } from "@greybots/common/supabase/client";

import { useAuthStore } from "@/stores/auth-store";
import { loadPreferences, savePreferences, allianceEntryChoices } from "@/lib/preferences";
</script>

<template>
    <div class="main-content">
        <div class="user-tile">
            <h1>Profile</h1>
            <div>Name: {{ authStore.currentUserName || '(no name on file)' }}</div>
            <div>Scouting role: {{ authStore.role }}</div>
        </div>

        <div class="user-tile">
            <h1>Preferences</h1>
            <p>Remembered on this device.</p>
            <label class="preference">
                <span>Enter alliance teams on the Playoffs page by</span>
                <select id="pref-alliance-entry" class="preference-select" :value="preferences.allianceEntry"
                    @change="setAllianceEntry($event.target.value)">
                    <option v-for="choice in allianceEntryChoices" :key="choice.key" :value="choice.key">{{ choice.text }}</option>
                </select>
            </label>
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
            preferences: loadPreferences(),
            allianceEntryChoices,
        }
    },
    methods: {
        setAllianceEntry(value) {
            this.preferences = savePreferences({ allianceEntry: value });
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
        await this.authStore.checkUser();
    }
}
</script>

<style scoped>
.user-tile {
    margin-bottom: 20px;
}

.preference {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
}

.preference-select {
    padding: 8px 10px;
    min-height: 40px;
    border-radius: 8px;
    border: 1.5px solid rgba(128, 128, 128, 0.35);
    background: var(--tile-background-color);
    color: var(--primary-text-color);
    font: inherit;
}
</style>
