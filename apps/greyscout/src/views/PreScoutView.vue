<script setup lang="ts">
// @ts-nocheck
import SearchableDropdown from "@greybots/common/components/SearchableDropdown.vue";
import PreScoutSection from "@/components/PreScoutSection.vue";

import { useEventStore } from "@/stores/event-store";
import { queryTeamNumbers } from "@/lib/data-query";
import { toTeamNumber, compareTeamNumbers } from "@/lib/team-number";
</script>

<template>
    <div class="main-content">
        <h1>Pre-Scouting</h1>
        <div v-if="isDataAvailable">
            <SearchableDropdown :choices="teamFilters" v-model="currentTeamNumber" placeholder="Search team…">
            </SearchableDropdown>

            <PreScoutSection :team-number="teamNumber" :auto-edit="autoEditPrescout"></PreScoutSection>
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
            autoEditPrescout: false
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

        // Data Status's lead-only prescout-edit shortcut (issue #51) lands
        // here with ?team=&editPrescout=1 — capture both, then strip them
        // from the URL so a refresh/back-nav doesn't keep re-forcing edit
        // mode (mirrors PitScoutingView.vue's editPit handling from #31).
        const queryTeam = toTeamNumber(this.$route.query.team);
        if (queryTeam) {
            this.currentTeamNumber = queryTeam;
        }
        if (this.$route.query.editPrescout === '1') {
            this.autoEditPrescout = true;
        }
        if (this.$route.query.team != null || this.$route.query.editPrescout != null) {
            this.$router.replace({ path: '/prescout' });
        }

        this.loadTeamNumbers();
    }
}
</script>
