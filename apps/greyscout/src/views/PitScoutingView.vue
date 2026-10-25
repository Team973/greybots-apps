<script setup lang="ts">
// @ts-nocheck
import SearchableDropdown from "@greybots/common/components/SearchableDropdown.vue";
import PitScoutingSection from "@/components/PitScoutingSection.vue";

import { useEventStore } from "@/stores/event-store";
import { queryTeamNumbers } from "@/lib/data-query";
import { toTeamNumber, compareTeamNumbers } from "@/lib/team-number";
</script>

<template>
    <div class="main-content">
        <div v-if="isDataAvailable">
            <SearchableDropdown :choices="teamFilters" v-model="currentTeamNumber" placeholder="Search team…">
            </SearchableDropdown>

            <PitScoutingSection :team-number="teamNumber" :auto-edit="autoEditPit"></PitScoutingSection>
        </div>
        <div v-else-if="teamsLoaded">
            <h2>No Data Available</h2>
        </div>
    </div>
</template>

<script lang="ts">
export default {
    data() {
        return {
            eventStore: null,
            teamsLoaded: false,
            teamFilters: [],
            currentTeamNumber: null,
            autoEditPit: false
        }
    },
    methods: {
        async loadTeamNumbers() {
            await this.eventStore.updateEvent();
            const teamNumbersRows = await queryTeamNumbers(this.eventStore.eventId);

            this.teamFilters = teamNumbersRows
                .filter((row) => row.team_number)
                .sort((a, b) => compareTeamNumbers(a.team_number, b.team_number))
                .map((row) => ({ key: row.team_number, text: row.team_number + " - " + row.name }));

            if (!this.teamFilters.some(t => t.key === this.currentTeamNumber)) {
                this.currentTeamNumber = this.teamFilters[0]?.key ?? null;
            }

            this.teamsLoaded = true;
        }
    },
    computed: {
        isDataAvailable() {
            return this.teamFilters.length > 0;
        },
        // null until a team is picked.
        teamNumber() {
            return this.currentTeamNumber ?? null;
        }
    },
    created() {
        this.eventStore = useEventStore();

        // Data Status's lead-only pit-edit shortcut (issue #31) lands here
        // with ?team=&editPit=1 — capture both, then strip them from the URL
        // so a refresh/back-nav doesn't keep re-forcing edit mode.
        const queryTeam = toTeamNumber(this.$route.query.team);
        if (queryTeam) {
            this.currentTeamNumber = queryTeam;
        }
        if (this.$route.query.editPit === '1') {
            this.autoEditPit = true;
        }
        if (this.$route.query.team != null || this.$route.query.editPit != null) {
            this.$router.replace({ path: '/pit' });
        }

        this.loadTeamNumbers();
    }
}
</script>
