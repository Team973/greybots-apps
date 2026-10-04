<script setup lang="ts">
import { useRouter } from 'vue-router';
import RegisterForm from '@greybots/common/components/RegisterForm.vue';
import { useSessionStore } from '@/stores/session-store';
import { useSyncStore } from '@/stores/sync-store';

// Registration is the same in every greybots app (the shared RegisterForm):
// one account works in all of them. A new account is pending until a lead or
// admin approves it, so someone who is signed in straight away goes to the
// waiting page (the router sends them there).
const router = useRouter();
const session = useSessionStore();
const sync = useSyncStore();
const loginUrl = `${window.location.origin}/login`;

async function onRegistered() {
  await session.adoptWebSession();
  router.replace({ name: 'pending' });
}
</script>

<template>
  <div class="register">
    <h1>Preflight</h1>
    <div class="card">
      <h2>Register</h2>
      <p v-if="!sync.online" class="error-text">You're offline. Registering needs internet.</p>
      <RegisterForm :login-url="loginUrl" @registered="onRegistered" @login="router.push({ name: 'login' })" />
    </div>
  </div>
</template>

<style scoped>
.register {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  padding-top: 5vh;
}

h1 {
  margin-bottom: 8px;
}
</style>
