<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import '@material/web/button/filled-button';
import AuthInput from '@greybots/common/components/AuthInput.vue';
import { readFormValues } from '@greybots/common/lib/account';
import { supabase } from '@greybots/common/supabase/client';
import { rememberResetReturn, toResetReturn } from '@/lib/reset-return';

// Ask for a password reset email. Every greybots app's "Forgot password?"
// comes here (see @greybots/common/lib/hub), with `?return=` saying which
// app to go back to once the new password is saved.
const route = useRoute();

const returnTo = toResetReturn(route.query.return);

const email = ref('');
const error = ref<string | null>(null);
const sent = ref(false);
const busy = ref(false);

async function send(event: Event) {
  error.value = null;
  sent.value = false;
  // Autofill can fill the field without the form hearing about it.
  email.value = (readFormValues(event.target as HTMLFormElement)['email'] ?? email.value).trim();
  if (!email.value) {
    error.value = 'Enter your email.';
    return;
  }
  busy.value = true;
  try {
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.value, {
      redirectTo: `${window.location.origin}/reset-password`
    });
    if (resetError) throw new Error(resetError.message);
    rememberResetReturn(returnTo);
    sent.value = true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form class="card" @submit.prevent="send">
    <h1>Reset password</h1>
    <p class="hint">
      We'll email you a link to choose a new password. It works in every greybots app.
    </p>
    <AuthInput v-model="email" label="Email" type="email" name="email" autocomplete="username" />
    <p v-if="error" class="error-text">{{ error }}</p>
    <p v-if="sent" class="success-text">
      If that email has an account, a reset link is on its way. Open it on this device.
    </p>
    <md-filled-button type="submit" :disabled="busy">{{ busy ? 'Sending…' : 'Send reset email' }}</md-filled-button>
    <a v-if="returnTo" :href="returnTo.url" class="text-link">Back to {{ returnTo.appName }}</a>
    <RouterLink v-else to="/login" class="text-link">Back to sign in</RouterLink>
  </form>
</template>

<style scoped>
.text-link {
  align-self: center;
}
</style>
