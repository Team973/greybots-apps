<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink } from 'vue-router';
import AuthInput from '@greybots/common/components/AuthInput.vue';
import { readFormValues } from '@greybots/common/lib/account';
import '@material/web/button/filled-button';
import { useSessionStore } from '@/stores/session-store';
import { useSyncStore } from '@/stores/sync-store';

const emit = defineEmits<{ 'signed-in': [] }>();
const session = useSessionStore();
const sync = useSyncStore();

const email = ref('');
const password = ref('');
const error = ref<string | null>(null);
const busy = ref(false);

// Autofill and password managers can fill the fields without the form
// hearing about it, so their values are read from the form when signing in.
const form = ref<HTMLFormElement | null>(null);

async function signIn() {
  error.value = null;
  if (form.value) {
    const values = readFormValues(form.value);
    email.value = values['email'] ?? email.value;
    password.value = values['password'] ?? password.value;
  }
  if (!email.value.trim() || !password.value) {
    error.value = 'Enter your email and password.';
    return;
  }
  busy.value = true;
  try {
    await session.signInWeb(email.value.trim(), password.value);
    sync.syncNow();
    emit('signed-in');
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form ref="form" class="card" @submit.prevent="signIn">
    <h2>Sign in</h2>
    <p class="hint">Use your greybots-apps account (same as GreyScout).</p>
    <p v-if="!sync.online" class="error-text">
      You're offline. Signing in needs internet the first time; after that Preflight keeps working offline.
    </p>
    <AuthInput v-model="email" label="Email" type="email" name="email" autocomplete="username" />
    <AuthInput v-model="password" label="Password" type="password" name="password" autocomplete="current-password" />
    <p v-if="error" class="error-text">{{ error }}</p>
    <md-filled-button type="submit" :disabled="busy">Sign in</md-filled-button>
    <RouterLink to="/register" class="panel-link register-link">Need an account? Register</RouterLink>
  </form>
</template>
