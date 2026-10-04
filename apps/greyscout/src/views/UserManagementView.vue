<script setup lang="ts">
import UserManagement from '@greybots/common/components/UserManagement.vue';
import { useAuthStore } from '@/stores/auth-store';

// User management (issue #112): the same page in every greybots app. The
// sections and everything in them come from the shared component; this just
// gives it the full width of the page.
const authStore = useAuthStore();
// Our own scouting role may be what changed.
const onChanged = () => authStore.checkUser();
</script>

<template>
    <div class="main-content users-page">
        <header class="users-header">
            <h1>People</h1>
            <p>Everyone with a greybots-apps account, and their role in each app. Shared with Preflight: a change here shows up there.</p>
        </header>
        <UserManagement @changed="onChanged" />
    </div>
</template>

<style scoped>
.users-header h1 {
    margin: 0;
}

.users-header p {
    margin: 4px 0 16px;
    opacity: 0.7;
}
</style>
