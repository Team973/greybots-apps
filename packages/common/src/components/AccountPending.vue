<script setup lang="ts">
import '@material/web/button/filled-button';
import '@material/web/button/outlined-button';

// What a signed-in person sees when their account has no role in this app:
// a new account waiting to be approved, or one that's been deactivated.
// Shared by every greybots app.
defineProps<{
    appName: string;
    name?: string | null;
    deactivated?: boolean;
    // While the app re-reads the account ("Check again").
    checking?: boolean;
}>();
const emit = defineEmits<{ refresh: []; 'sign-out': [] }>();
</script>

<template>
    <div class="account-pending">
        <template v-if="deactivated">
            <h1>Account deactivated</h1>
            <p>
                <template v-if="name">{{ name }}, your</template><template v-else>Your</template> account has been
                deactivated, so it can't be used with {{ appName }} or the other greybots apps. An admin can restore it.
            </p>
        </template>
        <template v-else>
            <h1>Waiting for approval</h1>
            <p>
                <template v-if="name">Thanks, {{ name }}. Your</template><template v-else>Your</template> account is
                set up, but it doesn't have access to {{ appName }} yet. Ask a lead or admin to approve it from the
                People page.
            </p>
        </template>
        <div class="account-pending-actions">
            <md-filled-button v-if="!deactivated" :disabled="checking" @click="emit('refresh')">
                {{ checking ? 'Checking…' : 'Check again' }}
            </md-filled-button>
            <md-outlined-button @click="emit('sign-out')">Sign out</md-outlined-button>
        </div>
    </div>
</template>

<style scoped>
.account-pending {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-width: 520px;
}

.account-pending h1 {
    margin: 0;
    font-size: 1.5rem;
}

.account-pending p {
    margin: 0;
    opacity: 0.85;
}

.account-pending-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 8px;
}
</style>
