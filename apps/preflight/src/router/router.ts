import { createRouter, createWebHistory } from 'vue-router';
import type { Role } from '@/lib/roles';
import { useDeviceStore } from '@/stores/device-store';
import { useSessionStore } from '@/stores/session-store';
import BatteriesView from '@/views/BatteriesView.vue';
import BatteryDetailView from '@/views/BatteryDetailView.vue';
import BatteryLabelsView from '@/views/BatteryLabelsView.vue';
import ChecklistsView from '@/views/ChecklistsView.vue';
import EventReportView from '@/views/EventReportView.vue';
import EventScriptView from '@/views/EventScriptView.vue';
import LoginView from '@/views/LoginView.vue';
import NotesView from '@/views/NotesView.vue';
import OverviewView from '@/views/OverviewView.vue';
import PendingView from '@/views/PendingView.vue';
import PeopleView from '@/views/PeopleView.vue';
import PitDisplayView from '@/views/PitDisplayView.vue';
import PitSetupView from '@/views/PitSetupView.vue';
import RegisterView from '@/views/RegisterView.vue';
import RepairsView from '@/views/RepairsView.vue';
import SetupView from '@/views/SetupView.vue';
import ScheduleView from '@/views/ScheduleView.vue';
import SettingsView from '@/views/SettingsView.vue';
import StatsView from '@/views/StatsView.vue';

declare module 'vue-router' {
  interface RouteMeta {
    title?: string;
    // Routes are signed-in only unless this is explicitly false.
    requiresAuth?: boolean;
    minRole?: Role;
    // Full-screen page: no nav bar, and a kiosk never auto-locks on it.
    bare?: boolean;
    // On a kiosk (a shared pit device), reachable without signing in.
    kioskPublic?: boolean;
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: OverviewView, meta: { title: 'Overview', minRole: 'member' } },
    { path: '/setup', name: 'setup', component: SetupView, meta: { title: 'Setup', requiresAuth: false } },
    { path: '/login', name: 'login', component: LoginView, meta: { title: 'Sign in', requiresAuth: false } },
    // Registration is shared with the other greybots apps. Personal devices
    // only: kiosk crew are added by the device's admin.
    { path: '/register', name: 'register', component: RegisterView, meta: { title: 'Register', requiresAuth: false } },
    // Where a signed-in account with no Preflight role lands: a new account
    // waiting for approval, or a deactivated one.
    { path: '/pending', name: 'pending', component: PendingView, meta: { title: 'Waiting for approval' } },
    // Everyone with a greybots-apps account and their role in each app.
    { path: '/people', name: 'people', component: PeopleView, meta: { title: 'People', minRole: 'member' } },
    { path: '/schedule', name: 'schedule', component: ScheduleView, meta: { title: 'Schedule', minRole: 'member' } },
    { path: '/checklists', name: 'checklists', component: ChecklistsView, meta: { title: 'Checklists', minRole: 'member' } },
    { path: '/batteries', name: 'batteries', component: BatteriesView, meta: { title: 'Batteries', minRole: 'member' } },
    { path: '/batteries/labels', name: 'battery-labels', component: BatteryLabelsView, meta: { title: 'Battery labels', minRole: 'member' } },
    { path: '/batteries/:number', name: 'battery', component: BatteryDetailView, meta: { title: 'Battery', minRole: 'member' } },
    { path: '/repairs', name: 'repairs', component: RepairsView, meta: { title: 'Repairs', minRole: 'member' } },
    { path: '/notes', name: 'notes', component: NotesView, meta: { title: 'Notes', minRole: 'member' } },
    // The pit display runs unattended on a TV: read-only, and on a kiosk it
    // stays up while the device is locked.
    // It's also the one page observers (accounts not yet made members) get.
    { path: '/display', name: 'display', component: PitDisplayView, meta: { title: 'Pit display', bare: true, kioskPublic: true } },
    { path: '/pit-setup', name: 'pit-setup', component: PitSetupView, meta: { title: 'Pit setup', minRole: 'lead' } },
    { path: '/stats', name: 'stats', component: StatsView, meta: { title: 'Stats', minRole: 'member' } },
    // The printable event script, for leads and admins.
    { path: '/script', name: 'script', component: EventScriptView, meta: { title: 'Event script', minRole: 'lead' } },
    // The printable event report, the data export, and wiping the event's
    // data afterwards: admins only.
    { path: '/report', name: 'report', component: EventReportView, meta: { title: 'Event report', minRole: 'admin' } },
    { path: '/settings', name: 'settings', component: SettingsView, meta: { title: 'Settings', minRole: 'member' } },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
});

router.beforeEach((to) => {
  const device = useDeviceStore();
  const session = useSessionStore();

  // First run: the device must pick kiosk or web mode before anything else.
  if (!device.isConfigured) return to.name === 'setup' ? true : { name: 'setup' };
  if (to.name === 'setup') return { name: 'home' };

  if (to.meta.kioskPublic && device.isKiosk) return true;
  if ((to.name === 'login' || to.name === 'register') && session.isSignedIn) return { name: 'home' };
  if (to.name === 'register' && device.isKiosk) return { name: 'login' };
  if (to.meta.requiresAuth !== false && !session.isSignedIn) {
    return { name: 'login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : undefined };
  }
  // An account with no role here (pending or deactivated) gets the waiting
  // page and nothing else.
  if (session.isSignedIn && !session.hasRole('observer')) return to.name === 'pending' ? true : { name: 'pending' };
  if (to.name === 'pending') return { name: 'home' };
  // Not allowed here: members and above go to the Overview; an observer's
  // only page is the pit display.
  if (to.meta.minRole && !session.hasRole(to.meta.minRole)) return { name: session.hasRole('member') ? 'home' : 'display' };
  return true;
});

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} | Preflight` : 'Preflight';
});

export default router;
