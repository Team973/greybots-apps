<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import KioskLogin from '@/components/KioskLogin.vue';
import WebLogin from '@/components/WebLogin.vue';
import { useDeviceStore } from '@/stores/device-store';

const device = useDeviceStore();
const route = useRoute();
const router = useRouter();

function onSignedIn() {
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
  router.replace(redirect);
}
</script>

<template>
  <div class="login">
    <h1>Preflight</h1>
    <p class="hint">{{ device.deviceName }}</p>
    <KioskLogin v-if="device.isKiosk" @signed-in="onSignedIn" />
    <WebLogin v-else @signed-in="onSignedIn" />
  </div>
</template>

<style scoped>
.login {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  padding-top: 5vh;
}

h1 {
  margin-bottom: 0;
}

.hint {
  opacity: 0.7;
  margin-top: 4px;
}
</style>
