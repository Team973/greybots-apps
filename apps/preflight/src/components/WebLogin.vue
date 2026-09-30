<script setup lang="ts">
import { ref } from 'vue';
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

async function signIn() {
  error.value = null;
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
    <TextInput v-model="email" label="Email" type="email" />
    <TextInput v-model="password" label="Password" type="password" @keyup.enter="signIn" />
    <p v-if="error" class="error-text">{{ error }}</p>
    <md-filled-button :disabled="busy" @click="signIn">Sign in</md-filled-button>
  </form>
</template>
