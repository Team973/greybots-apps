<script setup lang="ts">
import { ref } from 'vue';
import '@material/web/button/filled-button';
import '@material/web/button/text-button';
import AuthInput from './AuthInput.vue';
import { readFormValues, registerAccount } from '../lib/account';

// The registration form, shared by every greybots app: one account works in
// all of them. A new account is pending until a lead or admin gives it a
// role, so the app decides where to send the person next:
// - `registered` when they're signed in already (no email confirmation);
// - otherwise the form tells them to confirm their email, then log in.
const props = defineProps<{
    // The app's login page, where the confirmation email's link lands.
    loginUrl: string;
}>();
const emit = defineEmits<{ registered: []; login: [] }>();

const name = ref('');
const email = ref('');
const password = ref('');
const confirm = ref('');
const missing = ref({ name: false, email: false, password: false, confirm: false });
const error = ref('');
const confirmationSent = ref(false);
const busy = ref(false);

const form = ref<HTMLFormElement | null>(null);

async function register() {
    error.value = '';
    // Read the fields themselves: a password manager may have filled them
    // without the form hearing about it.
    if (form.value) {
        const values = readFormValues(form.value);
        name.value = values['name'] ?? name.value;
        email.value = values['email'] ?? email.value;
        password.value = values['new-password'] ?? password.value;
        confirm.value = values['confirm-password'] ?? confirm.value;
    }

    missing.value = { name: !name.value.trim(), email: !email.value.trim(), password: !password.value, confirm: !confirm.value };
    if (Object.values(missing.value).some(Boolean)) return;
    if (password.value !== confirm.value) {
        missing.value.confirm = true;
        error.value = 'Passwords do not match.';
        return;
    }

    busy.value = true;
    try {
        const result = await registerAccount({ name: name.value, email: email.value, password: password.value, emailRedirectTo: props.loginUrl });
        if (result.signedIn) emit('registered');
        else confirmationSent.value = true;
    } catch (e) {
        error.value = e instanceof Error ? e.message : String(e);
    } finally {
        busy.value = false;
    }
}
</script>

<template>
    <form ref="form" class="register-form" @submit.prevent="register">
        <template v-if="!confirmationSent">
            <p class="register-note">
                One account works across the greybots apps. After you register, a lead or admin has to approve your
                account before you can use them.
            </p>
            <AuthInput v-model="name" label="Name" name="name" autocomplete="name" :error="missing.name" />
            <AuthInput v-model="email" label="Email" type="email" name="email" autocomplete="email" :error="missing.email" />
            <AuthInput v-model="password" label="Password" type="password" name="new-password" autocomplete="new-password" :error="missing.password" />
            <AuthInput v-model="confirm" label="Confirm password" type="password" name="confirm-password" autocomplete="new-password" :error="missing.confirm" />
            <p v-if="error" class="register-error">{{ error }}</p>
            <md-filled-button type="submit" :disabled="busy">{{ busy ? 'Registering…' : 'Register' }}</md-filled-button>
        </template>
        <p v-else class="register-success">
            Check your email to confirm your account, then log in. A lead or admin will need to approve it before you
            can use the apps.
        </p>
        <md-text-button type="button" @click="emit('login')">Already have an account? Log in</md-text-button>
    </form>
</template>

<style scoped>
.register-form {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 16px;
    width: 100%;
    max-width: 420px;
}

.register-note {
    margin: 0;
    opacity: 0.75;
    font-size: 0.9rem;
}

.register-error {
    margin: 0;
    color: #c0392b;
}

.register-success {
    margin: 0;
    color: #3a9e3a;
}
</style>
