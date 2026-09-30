<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import TextInput from '@greybots/common/components/TextInput.vue';
import '@material/web/button/filled-button';
import '@material/web/button/text-button';
import { createKioskUser, validatePin } from '@/lib/kiosk-users';
import { useDeviceStore, type DeviceMode } from '@/stores/device-store';
import { useSessionStore } from '@/stores/session-store';

const device = useDeviceStore();
const session = useSessionStore();
const router = useRouter();

// Crypto (PIN hashing) and the offline service worker need a secure context:
// HTTPS, or http://localhost.
const isSecure = window.isSecureContext;

const mode = ref<DeviceMode | null>(null);
const deviceName = ref('');
const adminName = ref('');
const adminPin = ref('');
const adminPinConfirm = ref('');
const error = ref<string | null>(null);
const busy = ref(false);

async function finish() {
  error.value = null;
  if (!mode.value) return;

  if (mode.value === 'kiosk') {
    if (!adminName.value.trim()) return (error.value = 'Enter a name for the admin');
    const pinError = validatePin(adminPin.value);
    if (pinError) return (error.value = pinError);
    if (adminPin.value !== adminPinConfirm.value) return (error.value = "PINs don't match");
  }

  busy.value = true;
  try {
    if (mode.value === 'kiosk') {
      // Create the admin before saving the mode, so a failure here can't
      // leave a kiosk device with nobody able to sign in.
      const admin = await createKioskUser(adminName.value, 'admin', adminPin.value);
      await device.configure('kiosk', deviceName.value);
      await session.signInKiosk(admin.id, adminPin.value);
      router.replace({ name: 'home' });
    } else {
      await device.configure('web', deviceName.value);
      router.replace({ name: 'login' });
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="setup">
    <h1>Set up Preflight</h1>

    <div v-if="!isSecure" class="card">
      <h2>Insecure connection</h2>
      <p class="error-text">
        Preflight must be opened over HTTPS or from http://localhost. Offline mode and kiosk PINs won't work on this
        address.
      </p>
    </div>

    <template v-if="!mode">
      <p class="hint">How will this device be used? This can only be changed by resetting the device.</p>
      <button class="mode-card card" @click="mode = 'kiosk'">
        <h2>Kiosk</h2>
        <p class="hint">
          A shared pit laptop or tablet. Crew members sign in with a local PIN — no internet needed. A lead can link a
          greybots-apps account to sync when internet is available.
        </p>
      </button>
      <button class="mode-card card" @click="mode = 'web'">
        <h2>Personal</h2>
        <p class="hint">
          Your own device. Sign in with your greybots-apps account (the same one you use for GreyScout). Keeps working
          offline once you've signed in.
        </p>
      </button>
    </template>

    <div v-else class="card">
      <h2>{{ mode === 'kiosk' ? 'Kiosk device' : 'Personal device' }}</h2>
      <TextInput v-model="deviceName" label="Device name (e.g. Pit Tablet 1)" />
      <template v-if="mode === 'kiosk'">
        <p class="hint">Create the first admin. Admins can add crew members and change device settings.</p>
        <TextInput v-model="adminName" label="Admin name" />
        <div class="form-row">
          <TextInput v-model="adminPin" label="PIN" type="password" />
          <TextInput v-model="adminPinConfirm" label="Confirm PIN" type="password" />
        </div>
      </template>
      <p v-if="error" class="error-text">{{ error }}</p>
      <div class="form-row">
        <md-filled-button :disabled="busy" @click="finish">Finish setup</md-filled-button>
        <md-text-button :disabled="busy" @click="mode = null">Back</md-text-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.setup {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-width: 640px;
  padding-top: 5vh;
}

.mode-card {
  border: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.mode-card:hover {
  outline: 2px solid var(--header-color);
}
</style>
