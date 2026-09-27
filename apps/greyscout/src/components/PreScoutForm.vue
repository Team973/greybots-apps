<script setup lang="ts">
// @ts-nocheck
import FormSection from "@greybots/common/components/FormSection.vue";

import { preScoutTable } from "@/lib/constants";
import { getPreScoutSchema } from "@/lib/2026/pre-scout-form";
import { validateForm, parseScoutData, submitScoutData, updateScoutData } from "@/lib/data-submission";
import { fetchPreScoutDataById } from "@/lib/prescout-query";
import { useEventStore } from "@/stores/event-store";
import { useOfflineQueueStore } from "@/stores/offline-queue-store";

import "@material/web/button/filled-button";
</script>

<template>
    <div class="prescout-form">
        <form v-if="formLoaded">
            <FormSection v-for="section in scoutForm" :section-key="section.key" :name="section.name"
                :components="section.components" color="gray" @form-update="formValidation"></FormSection>
        </form>
        <div v-else>Loading form…</div>

        <div class="data-tile error-tile" v-if="formInvalid">
            <h1>^^^ Form is invalid. Please check the form for errors ^^^</h1>
        </div>

        <div class="button-container" v-if="formLoaded && !isSubmitting">
            <md-filled-button v-on:click="cancel" class="cancel-button">CANCEL</md-filled-button>
            <md-filled-button v-on:click="submitForm" class="submit-button">SAVE</md-filled-button>
        </div>
    </div>
</template>

<script lang="ts">
export default {
    props: {
        teamNumber: {
            type: Number,
            required: true
        },
        preScoutDataId: {
            type: Number,
            default: null
        }
    },
    emits: ["saved", "cancel"],
    data() {
        return {
            eventStore: null,
            queueStore: null,
            scoutForm: null,
            formLoaded: false,
            submitData: {},
            formInvalid: false,
            isSubmitting: false
        }
    },
    methods: {
        async loadForm() {
            this.formLoaded = false;

            let existingData = null;
            if (this.preScoutDataId != null) {
                existingData = await fetchPreScoutDataById(this.preScoutDataId);
            }

            this.scoutForm = await getPreScoutSchema({ includeTeamSelector: false, existingData });
            this.formLoaded = true;
        },
        formValidation() {
            this.formInvalid = false;

            const { data, valid } = validateForm(this.scoutForm);
            this.scoutForm = data;
            this.formInvalid = !valid;

            return valid;
        },
        async submitForm() {
            this.isSubmitting = true;

            if (!this.formValidation()) {
                this.isSubmitting = false;
                return;
            }

            this.submitData = parseScoutData(this.scoutForm, this.eventStore.eventId);
            // The team dropdown is omitted from the embedded form (the team is
            // already chosen in Team Analysis / the Prescout page), so fill it
            // in directly.
            this.submitData['prescout_team_number'] = this.teamNumber;

            const error = this.preScoutDataId != null
                ? await updateScoutData(this.preScoutDataId, this.submitData, preScoutTable)
                : await submitScoutData(this.submitData, preScoutTable);

            if (error) {
                console.log(error);
                this.queueStore.enqueue(
                    'scout_data',
                    { table: preScoutTable, data: this.submitData, id: this.preScoutDataId },
                    error.message ?? String(error)
                );

                this.isSubmitting = false;
                this.$emit('saved', { queuedOffline: true });
                return;
            }

            this.isSubmitting = false;
            this.$emit('saved', { queuedOffline: false });
        },
        cancel() {
            this.$emit('cancel');
        }
    },
    created() {
        this.eventStore = useEventStore();
        this.queueStore = useOfflineQueueStore();
        this.loadForm();
    }
}
</script>

<style scoped>
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
</style>
