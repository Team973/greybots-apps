import { createRouter, createWebHashHistory } from 'vue-router';
import OffloadView from '@/views/OffloadView.vue';
import PrintReportView from '@/views/PrintReportView.vue';
import ReportsView from '@/views/ReportsView.vue';
import SettingsView from '@/views/SettingsView.vue';
import SignalsView from '@/views/SignalsView.vue';
import StorageView from '@/views/StorageView.vue';

declare module 'vue-router' {
  interface RouteMeta {
    title?: string;
    // Shown alone, without the nav bar: a report being printed.
    bare?: boolean;
  }
}

const router = createRouter({
  // The installed app loads its page from a file, where only hash routes work.
  history: createWebHashHistory(),
  routes: [
    // Signals is what the app opens on.
    { path: '/', redirect: '/signals' },
    { path: '/signals', name: 'signals', component: SignalsView, meta: { title: 'Signals' } },
    { path: '/reports', name: 'reports', component: ReportsView, meta: { title: 'Reports' } },
    { path: '/download', name: 'offload', component: OffloadView, meta: { title: 'Download' } },
    // Its old name, before it was called Download.
    { path: '/offload', redirect: '/download' },
    { path: '/storage', name: 'storage', component: StorageView, meta: { title: 'Storage' } },
    { path: '/settings', name: 'settings', component: SettingsView, meta: { title: 'Settings' } },
    // What Save as PDF prints, in a window of its own (main/index.ts).
    { path: '/print/report/:id', name: 'print-report', component: PrintReportView, meta: { title: 'Report', bare: true } },
    { path: '/:pathMatch(.*)*', redirect: '/signals' }
  ]
});

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} | Greybots Diagnostics` : 'Greybots Diagnostics';
});

export default router;
