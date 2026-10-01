import './assets/main.css';

import { createApp } from 'vue';
import { createPinia } from 'pinia';

import App from './App.vue';
import router from './router/router';
import { requestPersistentStorage } from './lib/db';
import { loadTestingClock } from './lib/testing-clock';
import { useDeviceStore } from './stores/device-store';
import { useSessionStore } from './stores/session-store';
import { useSyncStore } from './stores/sync-store';

async function start() {
  const app = createApp(App);
  app.use(createPinia());

  // Device config and the signed-in user must be known before the router's
  // first navigation guard runs. Both come from local storage only, so
  // startup never waits on the network.
  loadTestingClock();
  const device = useDeviceStore();
  await device.load();
  await useSessionStore().restore();
  useSyncStore().init();
  requestPersistentStorage();

  app.use(router);
  app.mount('#app');
}

start();
