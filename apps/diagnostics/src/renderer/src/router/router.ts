import { createRouter, createWebHashHistory } from 'vue-router';
import OffloadView from '@/views/OffloadView.vue';
import SettingsView from '@/views/SettingsView.vue';
import SignalsView from '@/views/SignalsView.vue';
import StorageView from '@/views/StorageView.vue';

declare module 'vue-router' {
  interface RouteMeta {
    title?: string;
  }
}

const router = createRouter({
  // The installed app loads its page from a file, where only hash routes work.
  history: createWebHashHistory(),
  routes: [
    // Signals is what the app opens on.
    { path: '/', redirect: '/signals' },
    { path: '/signals', name: 'signals', component: SignalsView, meta: { title: 'Signals' } },
    { path: '/offload', name: 'offload', component: OffloadView, meta: { title: 'Offload' } },
    { path: '/storage', name: 'storage', component: StorageView, meta: { title: 'Storage' } },
    { path: '/settings', name: 'settings', component: SettingsView, meta: { title: 'Settings' } },
    { path: '/:pathMatch(.*)*', redirect: '/signals' }
  ]
});

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} | Greybots Diagnostics` : 'Greybots Diagnostics';
});

export default router;
