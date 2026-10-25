<script setup lang="ts">
// TODO: fix types
// @ts-nocheck

import "@material/web/button/filled-button";

import { useEventStore } from "@/stores/event-store";
import { refreshEventData } from "@/lib/tba-query";
import { getEventList, getEventOverride, setEventOverride } from "@/lib/event-management";
</script>

<template>
    <div class="main-content">
        <div class="user-tile">
            <h1>Event Management</h1>
            <div>Current event: {{ eventStore.eventName || eventStore.eventId }}</div>
            <p class="event-hint" v-if="eventStore.isOverridden">Picked for this device — everyone else sees the
                automatically chosen event.</p>
        </div>

        <div class="user-tile">
            <h1>Viewing Event</h1>
            <p class="event-hint">Which event this device shows. Only changes the app on this device: everyone else
                keeps the event picked automatically from today's date.</p>
            <label class="preference">
                <span>Event</span>
                <select id="event-select" class="preference-select" :value="selectedEventId" :disabled="eventChanging"
                    @change="selectEvent($event.target.value)">
                    <option value="">Automatic (by date)</option>
                    <option v-for="event in events" :key="event.event_id" :value="event.event_id">
                        {{ event.name }} ({{ event.event_id }})
                    </option>
                </select>
            </label>
            <p v-if="eventListError" class="form-error">{{ eventListError }}</p>
        </div>

        <div class="user-tile">
            <h1>Event Data</h1>
            <p class="event-hint">Pulls the team list and match schedule from The Blue Alliance for the current event.
                A team that has dropped out of the event is removed from the app.</p>
            <md-filled-button v-on:click="refreshEventData" :disabled="eventRefreshing" class="load-button">
                {{ eventRefreshing ? 'Refreshing…' : 'Refresh Event Data' }}
            </md-filled-button>
            <p v-if="eventRefreshMessage" class="event-refresh-message">{{ eventRefreshMessage }}</p>
            <p v-if="eventRefreshError" class="form-error">{{ eventRefreshError }}</p>
            <md-filled-button v-on:click="$router.push('/event-teams')" class="load-button">Event teams</md-filled-button>
        </div>
    </div>
</template>

<script lang="ts">
export default {
    data() {
        return {
            eventStore: null,
            events: [],
            eventListError: "",
            selectedEventId: getEventOverride() ?? "",
            eventChanging: false,
            eventRefreshing: false,
            eventRefreshMessage: "",
            eventRefreshError: "",
        }
    },
    methods: {
        async selectEvent(eventId) {
            this.eventChanging = true;
            setEventOverride(eventId);
            this.selectedEventId = eventId;
            this.eventRefreshMessage = "";
            this.eventRefreshError = "";
            await this.eventStore.updateEvent();
            this.eventChanging = false;
        },
        async refreshEventData() {
            this.eventRefreshing = true;
            this.eventRefreshMessage = "";
            this.eventRefreshError = "";

            const { teamCount, removedTeams, matchCount, error } = await refreshEventData(this.eventStore.eventId);

            if (error) {
                this.eventRefreshError = error.message;
            } else {
                const teams = teamCount > 0
                    ? `${teamCount} team${teamCount === 1 ? '' : 's'}`
                    : "TBA has no team list yet, so the teams weren't changed";
                const removed = removedTeams.length > 0 ? ` Removed (no longer at the event): ${removedTeams.join(', ')}.` : '';
                this.eventRefreshMessage = `Event refreshed — ${teams}; ${matchCount} match${matchCount === 1 ? '' : 'es'}.${removed}`;
            }

            this.eventRefreshing = false;
        }
    },
    async created() {
        this.eventStore = useEventStore();
        await this.eventStore.updateEvent();

        const { events, error } = await getEventList();
        if (error) {
            this.eventListError = error.message;
        }
        this.events = events;
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
    max-width: 100%;
    border-radius: 8px;
    border: 1.5px solid rgba(128, 128, 128, 0.35);
    background: var(--tile-background-color);
    color: var(--primary-text-color);
    font: inherit;
}

.form-error {
    color: #c0392b;
}

.event-hint {
    font-size: 13px;
    opacity: 0.8;
}

.event-refresh-message {
    color: #2f8a2f;
    font-size: 13px;
}
</style>
