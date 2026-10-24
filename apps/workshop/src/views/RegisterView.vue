<script setup lang="ts">
import { useRouter } from 'vue-router';
import RegisterForm from '@greybots/common/components/RegisterForm.vue';
import { useAuthStore } from '@/stores/auth-store';

// Registration is the same in every greybots app (the shared RegisterForm).
// A new account is pending until a lead or admin approves it; the home page
// says so to someone who's signed in straight away.
const router = useRouter();
const auth = useAuthStore();
const loginUrl = `${window.location.origin}/login`;

async function onRegistered() {
  await auth.refresh();
  router.replace({ name: 'home' });
}
</script>

<template>
  <div class="card">
    <h1>Register</h1>
    <RegisterForm :login-url="loginUrl" @registered="onRegistered" @login="router.push({ name: 'login' })" />
  </div>
</template>
