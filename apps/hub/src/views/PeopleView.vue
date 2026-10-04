<script setup lang="ts">
import UserManagement from '@greybots/common/components/UserManagement.vue';
import { useAuthStore } from '@/stores/auth-store';

// User management: the same page as in GreyScout and Preflight (the shared
// component), covering everyone's role in every app.
const auth = useAuthStore();
// Our own role may be what changed.
const onChanged = () => auth.refresh();
</script>

<template>
  <div class="people-view">
    <header class="page-header">
      <h1>People</h1>
      <p class="hint">Everyone with a greybots-apps account, and their role in each app. A change here shows up in the apps.</p>
    </header>
    <UserManagement @changed="onChanged" />
  </div>
</template>

<style scoped>
.people-view {
  width: 100%;
}

.page-header h1 {
  margin: 0;
  font-size: 1.5rem;
}

.page-header .hint {
  margin: 4px 0 16px;
}
</style>
