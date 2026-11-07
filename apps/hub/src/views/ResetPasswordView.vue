<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import '@material/web/button/filled-button';
import AuthInput from '@greybots/common/components/AuthInput.vue';
import { readFormValues } from '@greybots/common/lib/account';
import { supabase } from '@greybots/common/supabase/client';
import { useAuthStore } from '@/stores/auth-store';
import { recallResetReturn, rememberResetReturn, toResetReturn } from '@/lib/reset-return';

// Choose a new password. The link in a reset email (asked for on
// /forgot-password, from any greybots app) lands here and signs the person in
// for long enough to do it. Someone already signed in can change theirs here
// too. Afterwards they go back to the app that sent them, if one did.
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

// `?return=` comes with an older reset link forwarded from an app's own
// /reset-password page; otherwise it was remembered when the email was sent.
const returnTo = toResetReturn(route.query.return) ?? recallResetReturn();

const password = ref('');
const confirm = ref('');
const error = ref<string | null>(null);
const done = ref(false);
const busy = ref(false);

// A link that failed on the server (expired, or used up by an email scanner)
// comes back with the reason in the URL.
function linkError(): string | null {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  const code = hash.get('error_code') || query.get('error_code');
  const description = hash.get('error_description') || query.get('error_description');
  if (!code && !(hash.get('error') || query.get('error'))) return null;
  window.history.replaceState(null, '', window.location.pathname);
  return code === 'otp_expired'
    ? 'This reset link is invalid or has expired. Ask for a new one.'
    : description?.replace(/\+/g, ' ') ?? 'Something went wrong with that link. Ask for a new one.';
}
const linkProblem = linkError();

async function save(event: Event) {
  error.value = null;
  const values = readFormValues(event.target as HTMLFormElement);
  password.value = values['new-password'] ?? password.value;
  confirm.value = values['confirm-password'] ?? confirm.value;
  if (!password.value || !confirm.value) {
    error.value = 'Enter the new password twice.';
    return;
  }
  if (password.value !== confirm.value) {
    error.value = 'Passwords do not match.';
    return;
  }
  busy.value = true;
  try {
    const { error: updateError } = await supabase.auth.updateUser({ password: password.value });
    if (updateError) throw new Error(updateError.message);
    done.value = true;
    rememberResetReturn(null);
    await auth.refresh();
    if (returnTo) setTimeout(() => window.location.assign(returnTo.url), 2000);
    else setTimeout(() => router.replace({ name: 'home' }), 1500);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

const forgotLink = { name: 'forgot-password', query: returnTo ? { return: returnTo.url } : {} };
</script>

<template>
  <div v-if="!auth.isSignedIn" class="card">
    <h1>Reset password</h1>
    <p v-if="linkProblem" class="error-text">{{ linkProblem }}</p>
    <p v-else class="hint">Open this page from the link in your password reset email. If the link has expired, ask for a new one.</p>
    <RouterLink :to="forgotLink" class="text-link">Send a new reset email</RouterLink>
    <a v-if="returnTo" :href="returnTo.url" class="text-link">Back to {{ returnTo.appName }}</a>
    <RouterLink v-else to="/login" class="text-link">Back to sign in</RouterLink>
  </div>

  <form v-else class="card" @submit.prevent="save">
    <h1>Choose a new password</h1>
    <p class="hint">The new password works in every greybots app.</p>
    <AuthInput v-model="password" label="New password" type="password" name="new-password" autocomplete="new-password" />
    <AuthInput v-model="confirm" label="Confirm new password" type="password" name="confirm-password" autocomplete="new-password" />
    <p v-if="error" class="error-text">{{ error }}</p>
    <p v-if="done" class="success-text">
      Password updated.<template v-if="returnTo"> Taking you back to {{ returnTo.appName }} to sign in…</template>
    </p>
    <md-filled-button type="submit" :disabled="busy || done">{{ busy ? 'Saving…' : 'Save password' }}</md-filled-button>
    <a v-if="done && returnTo" :href="returnTo.url" class="text-link">Back to {{ returnTo.appName }}</a>
  </form>
</template>

<style scoped>
.text-link {
  align-self: center;
}
</style>
