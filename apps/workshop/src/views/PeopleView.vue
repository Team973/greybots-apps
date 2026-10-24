<script setup lang="ts">
import UserManagement from '@greybots/common/components/UserManagement.vue';
import { useAuthStore } from '@/stores/auth-store';
import { useDirectoryStore } from '@/stores/directory-store';

// User management: the same page as in every greybots app (the shared
// component), covering everyone's role in every app.
const auth = useAuthStore();
const directory = useDirectoryStore();
// Our own role may be what changed, and the people pickers should see anyone
// newly approved.
const onChanged = () => Promise.all([auth.refresh(), directory.loadPeople()]);
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1>People</h1>
      <p class="hint">Everyone with a greybots-apps account, and their role in each app. Give someone a Workshop role to let them in.</p>
    </header>
    <UserManagement @changed="onChanged" />
  </div>
</template>
