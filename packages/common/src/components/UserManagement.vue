<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import CollapsibleSection from './CollapsibleSection.vue';
import { supabase } from '../supabase/client';
import {
    accountStatus,
    allowedRoles,
    appRoleColumns,
    fetchAllUsers,
    isAnyAppAdmin,
    roleLabels,
    setUserDeactivated,
    updateUserName,
    updateUserRole,
    type AccountStatus,
    type AppRole,
    type AppRoleColumn,
    type UserAccount
} from '../lib/user-roles';

// User management, shared by every greybots app: everyone with an account,
// in three sections.
// - Pending: new accounts waiting for a lead or admin to give them a role.
// - Active: people with a role in at least one app, and their role in each.
// - Deactivated: accounts an admin switched off, which an admin can restore.
// A role can be changed from any app, by someone with enough authority in the
// app the role is for. Admins (of any app) can also rename people and
// deactivate anyone who isn't an admin. The database enforces all of this;
// the controls only offer what it will accept.
const emit = defineEmits<{ changed: [] }>();

const people = ref<UserAccount[]>([]);
const loaded = ref(false);
const error = ref('');
const currentUserId = ref<string | null>(null);
// "<user id>:<what>" while that change is being saved.
const saving = ref<string | null>(null);

const me = computed(() => people.value.find((p) => p.user_id === currentUserId.value) ?? null);
const iAmAdmin = computed(() => isAnyAppAdmin(me.value));
// Only the apps the database has a role column for (the Preflight column
// arrives with a migration).
const columns = computed(() => appRoleColumns.filter((c) => c.column === 'role' || people.value.some((p) => p[c.column] !== undefined)));

const byName = (a: UserAccount, b: UserAccount) => (a.name ?? '').localeCompare(b.name ?? '');
const inStatus = (status: AccountStatus) => people.value.filter((p) => accountStatus(p) === status);
// Pending accounts in the order they registered; the rest by name.
const pending = computed(() => inStatus('pending'));
const active = computed(() => inStatus('active').sort(byName));
const deactivated = computed(() => inStatus('deactivated').sort(byName));

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

async function act(key: string, action: () => Promise<void>) {
    error.value = '';
    saving.value = key;
    try {
        await action();
        emit('changed');
    } catch (e) {
        error.value = e instanceof Error ? e.message : String(e);
    } finally {
        saving.value = null;
    }
}

// --- Roles ---
function roleOf(person: UserAccount, column: AppRoleColumn): AppRole {
    return person[column.column] ?? 'pending';
}

// What the signed-in user may change this person's role to, in this app.
// Nobody changes their own role.
function choices(person: UserAccount, column: AppRoleColumn): AppRole[] {
    if (!me.value || person.user_id === currentUserId.value) return [];
    return allowedRoles(roleOf(me.value, column), roleOf(person, column));
}

function changeRole(person: UserAccount, column: AppRoleColumn, event: Event) {
    const select = event.target as HTMLSelectElement;
    const role = select.value as AppRole;
    if (role === roleOf(person, column)) return;
    return act(`${person.user_id}:${column.column}`, async () => {
        try {
            await updateUserRole(person.user_id, column.column, role);
            person[column.column] = role;
        } finally {
            // Whatever happened, show the role the person actually has.
            select.value = roleOf(person, column);
        }
    });
}

// --- Names ---
const canRename = (person: UserAccount) => iAmAdmin.value || person.user_id === currentUserId.value;
const renaming = ref<string | null>(null);
const nameDraft = ref('');
function startRename(person: UserAccount) {
    renaming.value = person.user_id;
    nameDraft.value = person.name ?? '';
}
function saveName(person: UserAccount) {
    const name = nameDraft.value.trim();
    if (!name || name === person.name) {
        renaming.value = null;
        return;
    }
    return act(`${person.user_id}:name`, async () => {
        await updateUserName(person.user_id, name);
        person.name = name;
        renaming.value = null;
    });
}

// --- Deactivating and restoring ---
// Admins can deactivate anyone who isn't an admin (in any app), and not
// themselves. It takes two presses: Deactivate, then Confirm.
const canDeactivate = (person: UserAccount) => iAmAdmin.value && person.user_id !== currentUserId.value && !isAnyAppAdmin(person);
const confirming = ref<string | null>(null);

function setDeactivated(person: UserAccount, value: boolean) {
    return act(`${person.user_id}:deactivated`, async () => {
        const updated = await setUserDeactivated(person.user_id, value);
        Object.assign(person, updated);
        confirming.value = null;
    });
}

const joined = (person: UserAccount) => new Date(person.created_at).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
const isSaving = (person: UserAccount, what: string) => saving.value === `${person.user_id}:${what}`;
</script>

<template>
    <div class="user-management">
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <div v-if="!loaded" class="um-empty">Loading people…</div>
        <div v-else-if="people.length === 0 && !error" class="um-empty">No users found.</div>

        <template v-else-if="people.length">
            <template v-for="section in [
                { key: 'pending', title: 'Pending', people: pending, empty: 'Nobody is waiting for approval.' },
                { key: 'active', title: 'Active', people: active, empty: 'Nobody has a role yet.' },
                { key: 'deactivated', title: 'Deactivated', people: deactivated, empty: 'No deactivated accounts.' }
            ]" :key="section.key">
                <CollapsibleSection :title="`${section.title} (${section.people.length})`" :default-open="section.key !== 'deactivated'" class="um-section">
                    <p v-if="section.key === 'pending'" class="um-hint">
                        New accounts can't use any app until a lead or admin gives them a role. Pick a role in an app to approve someone for it.
                    </p>
                    <p v-if="!section.people.length" class="um-empty">{{ section.empty }}</p>
                    <div v-else class="people-scroll">
                        <table class="people-table">
                            <thead>
                                <tr>
                                    <th class="um-name">Name</th>
                                    <th v-if="section.key !== 'active'">Registered</th>
                                    <template v-if="section.key !== 'deactivated'">
                                        <th v-for="column in columns" :key="column.column">{{ column.label }}</th>
                                    </template>
                                    <th v-if="iAmAdmin" class="um-actions-head">Account</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="person in section.people" :key="person.user_id">
                                    <td class="um-name">
                                        <form v-if="renaming === person.user_id" class="um-rename" @submit.prevent="saveName(person)">
                                            <input v-model="nameDraft" class="um-input" aria-label="Name" @keyup.esc="renaming = null" />
                                            <button type="submit" class="um-button" :disabled="isSaving(person, 'name')">Save</button>
                                            <button type="button" class="um-button um-quiet" @click="renaming = null">Cancel</button>
                                        </form>
                                        <template v-else>
                                            <span>{{ person.name || 'Unnamed user' }}</span>
                                            <span v-if="person.user_id === currentUserId" class="you">(you)</span>
                                            <button v-if="canRename(person) && section.key !== 'deactivated'" type="button" class="um-link" @click="startRename(person)">
                                                Rename
                                            </button>
                                        </template>
                                    </td>
                                    <td v-if="section.key !== 'active'" class="um-date">{{ joined(person) }}</td>
                                    <template v-if="section.key !== 'deactivated'">
                                        <td v-for="column in columns" :key="column.column">
                                            <select
                                                v-if="choices(person, column).length"
                                                class="um-input um-role"
                                                :value="roleOf(person, column)"
                                                :disabled="isSaving(person, column.column)"
                                                :aria-label="`${column.label} role for ${person.name || 'this user'}`"
                                                @change="changeRole(person, column, $event)"
                                            >
                                                <option :value="roleOf(person, column)">{{ roleLabels[roleOf(person, column)] }}</option>
                                                <option v-for="role in choices(person, column)" :key="role" :value="role">{{ roleLabels[role] }}</option>
                                            </select>
                                            <span v-else class="people-role" :class="{ 'um-muted': roleOf(person, column) === 'pending' }">
                                                {{ roleLabels[roleOf(person, column)] }}
                                            </span>
                                        </td>
                                    </template>
                                    <td v-if="iAmAdmin" class="um-actions">
                                        <template v-if="section.key === 'deactivated'">
                                            <button type="button" class="um-button" :disabled="isSaving(person, 'deactivated')" @click="setDeactivated(person, false)">
                                                {{ isSaving(person, 'deactivated') ? 'Restoring…' : 'Restore' }}
                                            </button>
                                        </template>
                                        <template v-else-if="canDeactivate(person)">
                                            <template v-if="confirming === person.user_id">
                                                <button type="button" class="um-button um-danger" :disabled="isSaving(person, 'deactivated')" @click="setDeactivated(person, true)">
                                                    {{ isSaving(person, 'deactivated') ? 'Deactivating…' : 'Confirm deactivate' }}
                                                </button>
                                                <button type="button" class="um-button um-quiet" @click="confirming = null">Cancel</button>
                                            </template>
                                            <button v-else type="button" class="um-button um-quiet" @click="confirming = person.user_id">Deactivate</button>
                                        </template>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </CollapsibleSection>
            </template>
        </template>
    </div>
</template>

<style scoped>
.user-management {
    width: 100%;
}

/* The sections line up with the page's own edges. */
.um-section {
    margin: 0 0 16px;
}

.um-hint,
.um-empty {
    margin: 0 0 8px;
    opacity: 0.7;
}

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
    white-space: nowrap;
}

.people-table th {
    font-size: 0.85em;
    font-weight: 600;
    opacity: 0.7;
}

/* The name takes whatever width the roles and actions leave. */
.um-name {
    width: 40%;
    white-space: normal;
}

.um-date {
    opacity: 0.8;
}

.um-actions,
.um-actions-head {
    text-align: right;
}

.um-actions .um-button + .um-button {
    margin-left: 6px;
}

.um-muted {
    opacity: 0.6;
}

.you {
    margin-left: 6px;
    opacity: 0.6;
    font-size: 0.85em;
}

.um-rename {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

.um-input {
    padding: 6px 8px;
    border-radius: 6px;
    border: 1px solid rgba(128, 128, 128, 0.6);
    background: var(--background-color);
    color: var(--primary-text-color);
    font: inherit;
}

.um-rename .um-input {
    flex: 1 1 160px;
    min-width: 0;
}

.um-role {
    min-width: 8.5em;
}

.um-button {
    padding: 6px 12px;
    border-radius: 6px;
    border: 1px solid var(--header-color, #b05703);
    background: var(--header-color, #b05703);
    color: var(--header-text-color, #fff);
    font: inherit;
    font-size: 0.9em;
    cursor: pointer;
}

.um-button:disabled {
    opacity: 0.6;
    cursor: default;
}

.um-button.um-quiet {
    border-color: rgba(128, 128, 128, 0.6);
    background: transparent;
    color: var(--primary-text-color);
}

.um-button.um-danger {
    border-color: #c0392b;
    background: #c0392b;
    color: #fff;
}

.um-link {
    margin-left: 8px;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    font-size: 0.85em;
    text-decoration: underline;
    opacity: 0.7;
    cursor: pointer;
}

.form-error {
    color: #c0392b;
}
</style>
