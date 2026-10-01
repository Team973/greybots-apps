import { createRouter, createWebHistory } from 'vue-router';
import type { Role } from '@/lib/roles';
import { useDeviceStore } from '@/stores/device-store';
import { useSessionStore } from '@/stores/session-store';
import BatteriesView from '@/views/BatteriesView.vue';
import BatteryDetailView from '@/views/BatteryDetailView.vue';
import BatteryLabelsView from '@/views/BatteryLabelsView.vue';
import LoginView from '@/views/LoginView.vue';
import NotesView from '@/views/NotesView.vue';
import OverviewView from '@/views/OverviewView.vue';
import PitSetupView from '@/views/PitSetupView.vue';
import RepairsView from '@/views/RepairsView.vue';
import SetupView from '@/views/SetupView.vue';
import ScheduleView from '@/views/ScheduleView.vue';
import SettingsView from '@/views/SettingsView.vue';

declare module 'vue-router' {
  interface RouteMeta {
    title?: string;
    // Routes are signed-in only unless this is explicitly false.
    requiresAuth?: boolean;
    minRole?: Role;
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: OverviewView, meta: { title: 'Overview' } },
    { path: '/setup', name: 'setup', component: SetupView, meta: { title: 'Setup', requiresAuth: false } },
    { path: '/login', name: 'login', component: LoginView, meta: { title: 'Sign in', requiresAuth: false } },
    { path: '/schedule', name: 'schedule', component: ScheduleView, meta: { title: 'Schedule', minRole: 'member' } },
    { path: '/batteries', name: 'batteries', component: BatteriesView, meta: { title: 'Batteries', minRole: 'member' } },
    { path: '/batteries/labels', name: 'battery-labels', component: BatteryLabelsView, meta: { title: 'Battery labels', minRole: 'member' } },
    { path: '/batteries/:number', name: 'battery', component: BatteryDetailView, meta: { title: 'Battery', minRole: 'member' } },
    { path: '/repairs', name: 'repairs', component: RepairsView, meta: { title: 'Repairs', minRole: 'member' } },
    { path: '/notes', name: 'notes', component: NotesView, meta: { title: 'Notes', minRole: 'member' } },
    { path: '/pit-setup', name: 'pit-setup', component: PitSetupView, meta: { title: 'Pit setup', minRole: 'member' } },
    { path: '/settings', name: 'settings', component: SettingsView, meta: { title: 'Settings' } },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
});

router.beforeEach((to) => {
  const device = useDeviceStore();
  const session = useSessionStore();

  // First run: the device must pick kiosk or web mode before anything else.
  if (!device.isConfigured) return to.name === 'setup' ? true : { name: 'setup' };
  if (to.name === 'setup') return { name: 'home' };

  if (to.name === 'login' && session.isSignedIn) return { name: 'home' };
  if (to.meta.requiresAuth !== false && !session.isSignedIn) {
    return { name: 'login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : undefined };
  }
  if (to.meta.minRole && !session.hasRole(to.meta.minRole)) return { name: 'home' };
  return true;
});

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} | Preflight` : 'Preflight';
});

export default router;
