<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import AccountPending from '@greybots/common/components/AccountPending.vue';
import { useSessionStore } from '@/stores/session-store';

// Where a signed-in account with no Preflight role lands: a new account
// waiting for a lead or admin to approve it, or a deactivated one.
const router = useRouter();
const session = useSessionStore();
const checking = ref(false);
const error = ref<string | null>(null);

// The router sends them on to the app once they've been given a role.
async function refresh() {
  checking.value = true;
  error.value = null;
  try {
    await session.refreshWebProfile();
    if (session.hasRole('observer')) router.replace({ name: 'home' });
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    checking.value = false;
  }
}

async function signOut() {
  await session.signOut();
  router.replace({ name: 'login' });
}
</script>

<template>
  <div class="card">
    <AccountPending
      app-name="Preflight"
      :name="session.user?.name"
      :deactivated="session.user?.role === 'deactivated'"
      :checking="checking"
      @refresh="refresh"
      @sign-out="signOut"
    />
    <p v-if="error" class="error-text">{{ error }}</p>
  </div>
</template>
