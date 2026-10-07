<script setup lang="ts">
// @ts-nocheck
import { RouterLink } from 'vue-router';
import FormSection from "@greybots/common/components/FormSection.vue";

import { matchScoutTable } from "@/lib/constants";
import { buildTeamRowSchema } from "@/lib/2026/match-scouting-form";
import { validateForm, parseScoutData, updateScoutData, deleteScoutData } from "@/lib/data-submission";
import { fetchMatchDataById, matchLabel } from "@/lib/picklist-query";
import { useOfflineQueueStore } from "@/stores/offline-queue-store";

import "@material/web/button/filled-button";
</script>

<template>
    <div class="main-content">
        <h1>Edit Match Submission</h1>

        <div v-if="!loaded" class="data-tile">Loading…</div>

        <div v-else-if="!matchRow" class="data-tile error-tile">
            <h1>Submission not found.</h1>
            <RouterLink to="/data-status" class="back-link">‹ Back to Data Status</RouterLink>
        </div>

        <template v-else>
            <div class="data-tile match-context">
                {{ matchLabel(matchRow.prematch_match_number, matchRow.prematch_match_type) }} — Team {{ matchRow.prematch_team_number }}
                ({{ matchRow.prematch_alliance }})
            </div>

            <form>
                <FormSection v-for="section in visibleSections" :key="section.key" :section-key="section.key"
                    :name="section.name" :components="section.components" :color="colorFor(section.key)"
                    @form-update="formValidation">
                </FormSection>
            </form>

            <div class="data-tile error-tile" v-if="formInvalid">
                <h1>^^^ Form is invalid. Please check the form for errors ^^^</h1>
            </div>

            <div class="data-tile error-tile" v-if="deleteError">
                <h1>Delete failed: {{ deleteError }}</h1>
            </div>

            <div class="button-container" v-if="!isSaving && !confirmingDelete">
                <RouterLink to="/data-status">
                    <md-filled-button class="cancel-button">CANCEL</md-filled-button>
                </RouterLink>
                <md-filled-button v-on:click="confirmingDelete = true" class="delete-button">DELETE</md-filled-button>
                <md-filled-button v-on:click="save" class="save-button">SAVE</md-filled-button>
            </div>

            <div class="button-container confirm-container" v-if="confirmingDelete">
                <span class="confirm-text">Delete this submission? This can't be undone.</span>
                <md-filled-button v-on:click="confirmingDelete = false" class="cancel-button">NO</md-filled-button>
                <md-filled-button v-on:click="doDelete" class="delete-button">YES, DELETE</md-filled-button>
            </div>
        </template>
    </div>
</template>

<script lang="ts">
export default {
    data() {
        return {
            queueStore: null,
            loaded: false,
            matchRow: null,
            schema: [],
            formInvalid: false,
            isSaving: false,
            confirmingDelete: false,
            deleteError: ''
        }
    },
    computed: {
        // Hide the defense-impact dropdown unless the team actually played
        // defense, same as MatchTeamRow.vue's create-flow filtering.
        visibleSections() {
            return this.schema.map((section) => {
                if (section.key !== 'postmatch') return section;
                const playedDefense = section.components.find((c) => c.key === 'played_defense')?.value;
                return {
                    ...section,
                    components: section.components.filter((c) => c.key !== 'defense_impact' || playedDefense)
                };
            });
        }
    },
    methods: {
        colorFor(sectionKey) {
            if (sectionKey === 'prematch') {
                return this.matchRow?.prematch_alliance?.toLowerCase() === 'blue' ? 'blue' : 'red';
            }
            return 'gray';
        },
        async loadMatchData() {
            this.loaded = false;
            const id = Number(this.$route.params.id);
            this.matchRow = await fetchMatchDataById(id);
            this.schema = this.matchRow ? buildTeamRowSchema({ existingData: this.matchRow }) : [];
            this.loaded = true;
        },
        formValidation() {
            this.formInvalid = false;

            const { data, valid } = validateForm(this.schema);
            this.schema = data;
            this.formInvalid = !valid;

            return valid;
        },
        async doDelete() {
            this.deleteError = '';

            const error = await deleteScoutData(this.matchRow.id, matchScoutTable);
            if (error) {
                console.log(error);
                this.deleteError = error.message ?? String(error);
                this.confirmingDelete = false;
                return;
            }

            this.$router.push('/data-status');
        },
        async save() {
            this.isSaving = true;
            this.saveSuccess = false;
            this.queuedOffline = false;

            if (!this.formValidation()) {
                this.isSaving = false;
                return;
            }

            // Reuse the submission's own event, and restore the identity fields
            // (not part of the editable schema — see match-scouting-form.ts),
            // so an edit can never reassign which match/team/alliance/event a
            // submission belongs to.
            const dbData = parseScoutData(this.schema, this.matchRow.event);
            dbData.prematch_team_number = this.matchRow.prematch_team_number;
            dbData.prematch_match_number = this.matchRow.prematch_match_number;
            dbData.prematch_alliance = this.matchRow.prematch_alliance;

            const error = await updateScoutData(this.matchRow.id, dbData, matchScoutTable);

            if (error) {
                console.log(error);
                this.queueStore.enqueue(
                    'scout_data',
                    { table: matchScoutTable, data: dbData, id: this.matchRow.id },
                    error.message ?? String(error)
                );
            }

            // Return to Data Status either way (issue #31) — a queue failure
            // still captured the edit for offline sync.
            this.isSaving = false;
            this.$router.push('/data-status');
        }
    },
    created() {
        this.queueStore = useOfflineQueueStore();
        this.loadMatchData();
    }
}
</script>

<style scoped>
.match-context {
    font-size: 15px;
    font-weight: 700;
    text-align: center;
}

.back-link {
    display: inline-block;
    margin-top: 10px;
}

.button-container {
    display: flex;
    justify-content: safe center;
    align-items: safe center;
    width: 100%;
}

md-filled-button {
    margin: 10px;
}

md-filled-button.cancel-button {
    --md-filled-button-container-color: rgba(128, 128, 128, 0.4);
}

md-filled-button.delete-button {
    --md-filled-button-container-color: #b03030;
}

.confirm-container {
    flex-wrap: wrap;
}

.confirm-text {
    font-size: 13px;
    color: var(--primary-text-color);
}

.error-tile {
    background-color: red;
    color: white;
}
</style>
