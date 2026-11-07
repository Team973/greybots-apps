<script setup lang="ts">
import { forwardResetLinkToHub } from '../lib/hub';

// An app's /reset-password page: passwords are reset on the hub now, so a
// reset link that still points here is sent on to the hub's page, sign-in
// and all, with this app's sign-in page to come back to.
const props = withDefaults(defineProps<{ loginPath?: string }>(), { loginPath: '/login' });

forwardResetLinkToHub(`${window.location.origin}${props.loginPath}`);
</script>

<template>
    <p class="hub-reset-redirect">Taking you to the Greybots hub to reset your password…</p>
</template>

<style scoped>
.hub-reset-redirect {
    text-align: center;
    padding: 32px 16px;
    opacity: 0.8;
}
</style>
