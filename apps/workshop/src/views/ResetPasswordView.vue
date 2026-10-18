<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import '@material/web/button/filled-button';
import AuthInput from '@greybots/common/components/AuthInput.vue';
import { readFormValues } from '@greybots/common/lib/account';
import { supabase } from '@greybots/common/supabase/client';
import { useAuthStore } from '@/stores/auth-store';

// Choose a new password. The link in a reset email lands here and signs the
// person in for long enough to do it.
const auth = useAuthStore();
const router = useRouter();

const password = ref('');
const confirm = ref('');
const error = ref<string | null>(null);
const done = ref(false);
const busy = ref(false);

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
    await auth.refresh();
    setTimeout(() => router.replace({ name: 'home' }), 1500);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="!auth.isSignedIn" class="card">
    <h1>Reset password</h1>
    <p class="hint">Open this page from the link in your password reset email. If the link has expired, ask for a new one.</p>
    <RouterLink to="/login" class="text-link">Back to sign in</RouterLink>
  </div>

  <form v-else class="card" @submit.prevent="save">
    <h1>Choose a new password</h1>
    <p class="hint">The new password works in every greybots app.</p>
    <AuthInput v-model="password" label="New password" type="password" name="new-password" autocomplete="new-password" />
    <AuthInput v-model="confirm" label="Confirm new password" type="password" name="confirm-password" autocomplete="new-password" />
    <p v-if="error" class="error-text">{{ error }}</p>
    <p v-if="done" class="success-text">Password updated.</p>
    <md-filled-button type="submit" :disabled="busy || done">{{ busy ? 'Saving…' : 'Save password' }}</md-filled-button>
  </form>
</template>
