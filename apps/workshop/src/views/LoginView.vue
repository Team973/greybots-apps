<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import '@material/web/button/filled-button';
import AuthInput from '@greybots/common/components/AuthInput.vue';
import { readFormValues } from '@greybots/common/lib/account';
import { hubForgotPasswordUrl } from '@greybots/common/lib/hub';
import { useAuthStore } from '@/stores/auth-store';

// Sign in with the greybots-apps account every app shares. A forgotten
// password is reset on the hub, which comes back here afterwards.
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const email = ref('');
const password = ref('');
const error = ref<string | null>(null);
const busy = ref(false);

// A confirmation or recovery link that failed on the server comes back here
// with the reason in the URL (e.g. a link that expired, or that an email
// scanner used up). Say so rather than showing a blank form.
function callbackError(): string | null {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  const code = hash.get('error_code') || query.get('error_code');
  const description = hash.get('error_description') || query.get('error_description');
  if (!code && !(hash.get('error') || query.get('error'))) return null;
  window.history.replaceState(null, '', window.location.pathname);
  return code === 'otp_expired'
    ? 'This link is invalid or has expired. Ask for a new one, or register again.'
    : description?.replace(/\+/g, ' ') ?? 'Something went wrong with that link. Try again or contact an admin.';
}
error.value = callbackError();

// Autofill and password managers can fill the fields without the form
// hearing about it, so their values are read from the form itself.
function read(event: Event) {
  const values = readFormValues(event.target as HTMLFormElement);
  email.value = (values['email'] ?? email.value).trim();
  password.value = values['password'] ?? password.value;
}

async function signIn(event: Event) {
  error.value = null;
  read(event);
  if (!email.value || !password.value) {
    error.value = 'Enter your email and password.';
    return;
  }
  busy.value = true;
  try {
    await auth.signIn(email.value, password.value);
    router.replace(typeof route.query.redirect === 'string' ? route.query.redirect : '/');
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

const forgotPasswordUrl = hubForgotPasswordUrl(`${window.location.origin}/login`);
</script>

<template>
  <form class="card" @submit.prevent="signIn">
    <h1>Sign in</h1>
    <p class="hint">Use your greybots-apps account: the same one as the other greybots apps.</p>
    <AuthInput v-model="email" label="Email" type="email" name="email" autocomplete="username" />
    <AuthInput v-model="password" label="Password" type="password" name="password" autocomplete="current-password" />
    <p v-if="error" class="error-text">{{ error }}</p>
    <md-filled-button type="submit" :disabled="busy">{{ busy ? 'Signing in…' : 'Sign in' }}</md-filled-button>
    <a :href="forgotPasswordUrl" class="text-link">Forgot password?</a>
    <RouterLink to="/register" class="text-link">Need an account? Register</RouterLink>
  </form>
</template>

<style scoped>
.text-link {
  align-self: center;
}
</style>
