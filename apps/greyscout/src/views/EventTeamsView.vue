<script setup lang="ts">
// @ts-nocheck
// The teams at the current event (issue #127), for leads and admins: the
// list as the app has it, plus adding and removing custom teams. A custom
// team is one The Blue Alliance doesn't list for the event, added by hand;
// refreshing the event data never removes it.
import { ref, computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { useAuthStore } from '@/stores/auth-store';
import { useEventStore } from '@/stores/event-store';
import { queryTeamNumbers, addCustomTeam, removeCustomTeam } from '@/lib/data-query';

const authStore = useAuthStore();
const eventStore = useEventStore();

const loaded = ref(false);
const teams = ref([]);

const sortedTeams = computed(() => [...teams.value].sort((a, b) => a.team_number - b.team_number));
const customCount = computed(() => teams.value.filter((team) => team.custom).length);

async function loadTeams() {
    teams.value = await queryTeamNumbers(eventStore.eventId);
    loaded.value = true;
}

onMounted(async () => {
    await authStore.checkUser();
    await eventStore.updateEvent();
    await loadTeams();
});

// ─── Add a custom team ─────────────────────────────────────────────────────────

const newNumber = ref('');
const newName = ref('');
const saving = ref(false);
const formError = ref('');
const formMessage = ref('');

// Team numbers are stored as a 16-bit integer.
const MAX_TEAM_NUMBER = 32767;

async function addTeam() {
    formError.value = '';
    formMessage.value = '';

    const raw = String(newNumber.value).trim();
    const teamNumber = Number(raw);
    const name = newName.value.trim();
    if (!/^\d+$/.test(raw) || teamNumber < 1 || teamNumber > MAX_TEAM_NUMBER) {
        formError.value = `Enter a team number from 1 to ${MAX_TEAM_NUMBER}.`;
        return;
    }
    if (!name) {
        formError.value = 'Enter a name for the team.';
        return;
    }
    if (teams.value.some((team) => team.team_number === teamNumber)) {
        formError.value = `Team ${teamNumber} is already at this event.`;
        return;
    }

    saving.value = true;
    const error = await addCustomTeam(eventStore.eventId, teamNumber, name);
    saving.value = false;

    if (error) {
        formError.value = `Couldn't add team ${teamNumber}: ${error.message ?? 'unknown error'}`;
        return;
    }

    newNumber.value = '';
    newName.value = '';
    formMessage.value = `Added team ${teamNumber}.`;
    await loadTeams();
}

// ─── Remove a custom team ──────────────────────────────────────────────────────

const confirmingRemove = ref(null);

async function removeTeam(team) {
    formError.value = '';
    formMessage.value = '';
    confirmingRemove.value = null;

    const error = await removeCustomTeam(team.key);
    if (error) {
        formError.value = `Couldn't remove team ${team.team_number}: ${error.message ?? 'unknown error'}`;
        return;
    }

    formMessage.value = `Removed team ${team.team_number}.`;
    await loadTeams();
}
</script>

<template>
    <div class="main-content">
        <div class="event-teams-page">
            <div class="event-teams-header">
                <h1>Event Teams</h1>
                <div class="event-teams-event">{{ eventStore.eventName || eventStore.eventId }}</div>
            </div>
            <p class="event-teams-hint">
                The teams the app shows for this event. The list comes from The Blue Alliance (refresh it under
                <RouterLink to="/account">Account → Event Management</RouterLink>). Add a custom team here for one The Blue
                Alliance doesn't list; a refresh never removes it.
            </p>

            <form class="data-tile event-teams-form" @submit.prevent="addTeam">
                <h2>Add a custom team</h2>
                <div class="event-teams-fields">
                    <label class="event-teams-field">
                        <span>Team number</span>
                        <input id="custom-team-number" v-model="newNumber" type="text" inputmode="numeric" pattern="[0-9]*"
                            autocomplete="off" placeholder="e.g. 9973" />
                    </label>
                    <label class="event-teams-field event-teams-field--name">
                        <span>Name</span>
                        <input id="custom-team-name" v-model="newName" type="text" autocomplete="off" maxlength="80"
                            placeholder="e.g. Greybots B" />
                    </label>
                    <button id="btn-add-custom-team" type="submit" class="event-teams-btn event-teams-btn--primary"
                        :disabled="saving">
                        {{ saving ? 'Adding…' : 'Add team' }}
                    </button>
                </div>
                <p v-if="formError" class="event-teams-error">{{ formError }}</p>
                <p v-else-if="formMessage" class="event-teams-message">{{ formMessage }}</p>
            </form>

            <div v-if="!loaded" class="event-teams-hint">Loading teams…</div>
            <template v-else>
                <h2>{{ sortedTeams.length }} team{{ sortedTeams.length === 1 ? '' : 's' }}<template v-if="customCount">
                        ({{ customCount }} custom)</template></h2>
                <p v-if="sortedTeams.length === 0" class="event-teams-hint">No teams are loaded for this event yet.</p>
                <ul v-else class="event-teams-list">
                    <li v-for="team in sortedTeams" :key="team.key" class="event-teams-row"
                        :class="{ 'event-teams-row--custom': team.custom }">
                        <RouterLink :to="`/team/${team.team_number}`" class="event-teams-number">{{ team.team_number }}</RouterLink>
                        <span class="event-teams-name">{{ team.name }}</span>
                        <template v-if="team.custom">
                            <span class="event-teams-tag">Custom</span>
                            <template v-if="confirmingRemove === team.key">
                                <span class="event-teams-confirm">Remove?</span>
                                <button type="button" class="event-teams-btn" @click="confirmingRemove = null">Cancel</button>
                                <button type="button" class="event-teams-btn event-teams-btn--danger"
                                    @click="removeTeam(team)">Yes, remove</button>
                            </template>
                            <button v-else type="button" class="event-teams-btn event-teams-btn--danger"
                                :title="`Remove custom team ${team.team_number}`" @click="confirmingRemove = team.key">
                                Remove
                            </button>
                        </template>
                    </li>
                </ul>
            </template>
        </div>
    </div>
</template>

<style scoped>
.event-teams-page {
    max-width: 720px;
    margin: 0 auto;
}

.event-teams-header {
    display: flex;
    align-items: baseline;
    gap: 16px;
    flex-wrap: wrap;
}

.event-teams-event {
    font-size: 14px;
    color: rgba(128, 128, 128, 0.8);
    font-style: italic;
}

.event-teams-hint {
    font-size: 13px;
    color: rgba(128, 128, 128, 0.9);
}

h2 {
    font-size: 16px;
    margin: 16px 0 10px;
}

.event-teams-form {
    align-items: stretch;
    margin: 12px 0;
    text-align: left;
}

.event-teams-form h2 {
    margin-top: 0;
}

.event-teams-fields {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 10px;
}

.event-teams-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    flex: 0 1 140px;
    min-width: 0;
}

.event-teams-field--name {
    flex: 1 1 200px;
}

.event-teams-field input {
    padding: 9px 10px;
    min-height: 40px;
    box-sizing: border-box;
    width: 100%;
    border-radius: 8px;
    border: 1.5px solid rgba(128, 128, 128, 0.35);
    background: transparent;
    color: var(--primary-text-color);
    font: inherit;
    font-size: 16px;
}

.event-teams-btn {
    background: rgba(128, 128, 128, 0.12);
    border: 1.5px solid transparent;
    border-radius: 8px;
    padding: 8px 14px;
    min-height: 40px;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    color: var(--primary-text-color);
    cursor: pointer;
}

.event-teams-btn:hover:not(:disabled) {
    border-color: rgba(176, 87, 3, 0.5);
}

.event-teams-btn:disabled {
    opacity: 0.5;
    cursor: default;
}

.event-teams-btn--primary {
    background: #b05703;
    color: #fff;
}

.event-teams-btn--danger {
    color: #d32f2f;
}

.event-teams-error {
    color: #d32f2f;
    font-size: 13px;
    margin: 10px 0 0;
}

.event-teams-message {
    color: #2e7d32;
    font-size: 13px;
    margin: 10px 0 0;
}

.event-teams-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.event-teams-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    padding: 8px 12px;
    min-height: 44px;
    box-sizing: border-box;
    border-radius: 8px;
    background: var(--tile-background-color);
}

.event-teams-row--custom {
    box-shadow: 0 0 0 1.5px rgba(176, 87, 3, 0.55);
}

.event-teams-number {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    min-width: 52px;
    color: inherit;
    text-decoration: none;
}

.event-teams-number:hover {
    text-decoration: underline;
}

.event-teams-name {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
}

.event-teams-tag {
    font-size: 11px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 6px;
    background: rgba(176, 87, 3, 0.18);
    color: #b05703;
}

.event-teams-confirm {
    font-size: 13px;
}
</style>
