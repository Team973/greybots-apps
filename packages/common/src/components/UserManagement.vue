<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import SearchableDropdown from './SearchableDropdown.vue';
import { supabase } from '../supabase/client';
import {
    allowedRoles,
    appRoleColumns,
    fetchAllUsers,
    updateUserRole,
    type AppRole,
    type AppRoleColumn,
    type UserAccount
} from '../lib/user-roles';

// The People table, shared by every greybots app: everyone with an account,
// and their role in each app. A role can be changed from any app, by someone
// with enough authority in the app the role is for (the database enforces
// this; the dropdowns only offer changes that will be accepted).
const emit = defineEmits<{ changed: [] }>();

const people = ref<UserAccount[]>([]);
const loaded = ref(false);
const error = ref('');
const currentUserId = ref<string | null>(null);
// "<user id>:<column>" while that change is being saved.
const saving = ref<string | null>(null);

const me = computed(() => people.value.find((p) => p.user_id === currentUserId.value) ?? null);
// Only the apps the database has a role column for (the Preflight column
// arrives with a migration).
const columns = computed(() => appRoleColumns.filter((c) => c.column === 'role' || people.value.some((p) => p[c.column] !== undefined)));

async function load() {
    error.value = '';
    try {
        const { data } = await supabase.auth.getSession();
        currentUserId.value = data.session?.user.id ?? null;
        people.value = await fetchAllUsers();
    } catch (e) {
        error.value = e instanceof Error ? e.message : String(e);
    } finally {
        loaded.value = true;
    }
}
onMounted(load);

function roleOf(person: UserAccount, column: AppRoleColumn): AppRole {
    return person[column.column] ?? 'observer';
}

// What the signed-in user may change this person's role to, in this app.
// Nobody changes their own role.
function choices(person: UserAccount, column: AppRoleColumn) {
    if (!me.value || person.user_id === currentUserId.value) return [];
    return allowedRoles(roleOf(me.value, column), roleOf(person, column)).map((role) => ({ key: role, text: role }));
}

async function changeRole(person: UserAccount, column: AppRoleColumn, role: AppRole | '') {
    if (!role) return;
    error.value = '';
    saving.value = `${person.user_id}:${column.column}`;
    try {
        await updateUserRole(person.user_id, column.column, role);
        person[column.column] = role;
        emit('changed');
    } catch (e) {
        error.value = e instanceof Error ? e.message : String(e);
    } finally {
        saving.value = null;
    }
}
</script>

<template>
    <div class="user-management">
        <div v-if="!loaded">Loading people…</div>
        <div v-else-if="people.length === 0 && !error">No users found.</div>
        <div v-else-if="people.length" class="people-scroll">
            <table class="people-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th v-for="column in columns" :key="column.column">{{ column.label }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="person in people" :key="person.user_id">
                        <td>
                            {{ person.name || 'Unnamed user' }}
                            <span v-if="person.user_id === currentUserId" class="you">(you)</span>
                        </td>
                        <td v-for="column in columns" :key="column.column">
                            <div class="role-cell">
                                <span class="people-role">{{ roleOf(person, column) }}</span>
                                <SearchableDropdown
                                    v-if="choices(person, column).length > 0"
                                    class="role-select"
                                    :choices="choices(person, column)"
                                    model-value=""
                                    :placeholder="saving === `${person.user_id}:${column.column}` ? 'Saving…' : 'Change role…'"
                                    @update:model-value="changeRole(person, column, $event)"
                                />
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
        <p v-if="error" class="form-error">{{ error }}</p>
    </div>
</template>

<style scoped>
/* Wide tables scroll sideways on a phone rather than squashing. */
.people-scroll {
    overflow-x: auto;
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
    vertical-align: middle;
}

.role-cell {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
}

.people-role {
    min-width: 5.5em;
    text-transform: capitalize;
}

.you {
    opacity: 0.6;
    font-size: 0.85em;
}

.role-select {
    display: block;
    min-width: 160px;
}

.form-error {
    color: #c0392b;
}
</style>
