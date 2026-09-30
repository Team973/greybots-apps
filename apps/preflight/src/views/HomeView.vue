<script setup lang="ts">
import { useSessionStore } from '@/stores/session-store';

const session = useSessionStore();
</script>

<template>
  <div class="card">
    <h2>Welcome, {{ session.user?.name }}</h2>
    <p class="hint">Pit crew features will live here.</p>
  </div>
</template>
