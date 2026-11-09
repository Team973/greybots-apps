import { createRouter, createWebHashHistory } from 'vue-router';
import AutosView from '@/views/AutosView.vue';
import LogExportView from '@/views/LogExportView.vue';
import LogImportView from '@/views/LogImportView.vue';
import PrintReportView from '@/views/PrintReportView.vue';
import ReportsView from '@/views/ReportsView.vue';
import SettingsView from '@/views/SettingsView.vue';
import SignalsView from '@/views/SignalsView.vue';

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
    // Autos compared: several robots' autonomous paths on one field.
    { path: '/autos', name: 'autos', component: AutosView, meta: { title: 'Autos' } },
    // Logs in: from the robot, files, and USB drives.
    { path: '/import', name: 'log-import', component: LogImportView, meta: { title: 'Log Import' } },
    // Logs out: to USB drives, and the data folder.
    { path: '/export', name: 'log-export', component: LogExportView, meta: { title: 'Log Export' } },
    // Their old names: Offload, then Download; and Storage.
    { path: '/offload', redirect: '/import' },
    { path: '/download', redirect: '/import' },
    { path: '/storage', redirect: '/export' },
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
