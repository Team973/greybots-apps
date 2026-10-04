<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink } from 'vue-router';
import TextInput from '@greybots/common/components/TextInput.vue';
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

// The fields themselves: autofill and password managers can fill them without
// the form hearing about it, so their values are read when signing in.
const emailField = ref<{ readValue: () => string } | null>(null);
const passwordField = ref<{ readValue: () => string } | null>(null);

async function signIn() {
  error.value = null;
  email.value = emailField.value?.readValue() ?? email.value;
  password.value = passwordField.value?.readValue() ?? password.value;
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
  <form class="card" @submit.prevent="signIn">
    <h2>Sign in</h2>
    <p class="hint">Use your greybots-apps account (same as GreyScout).</p>
    <p v-if="!sync.online" class="error-text">
      You're offline. Signing in needs internet the first time; after that Preflight keeps working offline.
    </p>
    <TextInput ref="emailField" v-model="email" label="Email" type="email" name="email" autocomplete="username" />
    <TextInput
      ref="passwordField"
      v-model="password"
      label="Password"
      type="password"
      name="password"
      autocomplete="current-password"
      @keyup.enter="signIn"
    />
    <p v-if="error" class="error-text">{{ error }}</p>
    <md-filled-button type="button" :disabled="busy" @click="signIn">Sign in</md-filled-button>
    <RouterLink to="/register" class="panel-link register-link">Need an account? Register</RouterLink>
  </form>
</template>
