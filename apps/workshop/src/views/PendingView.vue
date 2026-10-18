<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import AccountPending from '@greybots/common/components/AccountPending.vue';
import { useAuthStore } from '@/stores/auth-store';

// Where a signed-in account with no Workshop role lands: a new account
// waiting for a lead or admin to approve it, or a deactivated one.
const auth = useAuthStore();
const router = useRouter();
const checking = ref(false);

async function refresh() {
  checking.value = true;
  try {
    await auth.refresh();
    if (auth.hasAccess) router.replace({ name: 'home' });
  } finally {
    checking.value = false;
  }
}

async function signOut() {
  await auth.signOut();
  router.push({ name: 'login' });
}
</script>

<template>
  <div class="card">
    <AccountPending app-name="Workshop" :name="auth.profile?.name" :deactivated="auth.role === 'deactivated'" :checking="checking" @refresh="refresh" @sign-out="signOut" />
  </div>
</template>
