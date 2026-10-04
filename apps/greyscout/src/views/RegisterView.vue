<script setup lang="ts">
import { useRouter } from 'vue-router';
import RegisterForm from '@greybots/common/components/RegisterForm.vue';
import { useAuthStore } from '@/stores/auth-store';

// Registration is the same in every greybots app (the shared RegisterForm).
// A new account is pending until a lead or admin approves it, so someone who
// is signed in straight away goes to the waiting page.
const router = useRouter();
const authStore = useAuthStore();
const loginUrl = `${window.location.origin}/login`;

async function onRegistered() {
    await authStore.checkUser();
    router.push('/pending');
}
</script>

<template>
    <div class="main-content">
        <div class="login-tile">
            <h1 class="register-title">Register</h1>
            <RegisterForm :login-url="loginUrl" @registered="onRegistered" @login="router.push('/login')" />
        </div>
    </div>
</template>

<style scoped>
.register-title {
    padding: 15px;
}
</style>
