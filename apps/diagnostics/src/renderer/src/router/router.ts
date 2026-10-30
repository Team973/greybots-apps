import { createRouter, createWebHashHistory } from 'vue-router';
import LogsView from '@/views/LogsView.vue';
import OverviewView from '@/views/OverviewView.vue';
import SettingsView from '@/views/SettingsView.vue';
import SignalsView from '@/views/SignalsView.vue';

declare module 'vue-router' {
  interface RouteMeta {
    title?: string;
  }
}

const router = createRouter({
  // The installed app loads its page from a file, where only hash routes work.
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'overview', component: OverviewView, meta: { title: 'Overview' } },
    { path: '/logs', name: 'logs', component: LogsView, meta: { title: 'Logs' } },
    { path: '/signals', name: 'signals', component: SignalsView, meta: { title: 'Signals' } },
    { path: '/settings', name: 'settings', component: SettingsView, meta: { title: 'Settings' } },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
});

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} | Greybots Diagnostics` : 'Greybots Diagnostics';
});

export default router;
