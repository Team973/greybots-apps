import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth-store';
import { useDirectoryStore } from '@/stores/directory-store';
import HomeView from '@/views/HomeView.vue';
import LoginView from '@/views/LoginView.vue';
import RegisterView from '@/views/RegisterView.vue';
import HubResetRedirect from '@greybots/common/components/HubResetRedirect.vue';
import PendingView from '@/views/PendingView.vue';

declare module 'vue-router' {
  interface RouteMeta {
    title?: string;
    // Needs a Workshop role (observer and above), or lead and above.
    requiresAccess?: boolean;
    requiresLead?: boolean;
    // Only for people who aren't signed in.
    guestOnly?: boolean;
    // Gets the wider page column.
    wide?: boolean;
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView, meta: { title: 'My tasks', requiresAccess: true } },
    { path: '/tickets', name: 'tickets', component: () => import('@/views/TicketsView.vue'), meta: { title: 'Tickets', requiresAccess: true, wide: true } },
    { path: '/tickets/:number(\\d+)', name: 'ticket', component: () => import('@/views/TicketView.vue'), meta: { title: 'Ticket', requiresAccess: true, wide: true } },
    { path: '/sessions', name: 'sessions', component: () => import('@/views/SessionsView.vue'), meta: { title: 'Sessions', requiresAccess: true, wide: true } },
    { path: '/sessions/:id', name: 'session', component: () => import('@/views/SessionView.vue'), meta: { title: 'Session plan', requiresAccess: true } },
    { path: '/checklists', name: 'checklists', component: () => import('@/views/ChecklistsView.vue'), meta: { title: 'Checklists', requiresAccess: true } },
    { path: '/checklists/templates/new', name: 'checklist-template-new', component: () => import('@/views/ChecklistTemplateView.vue'), meta: { title: 'New checklist', requiresAccess: true } },
    { path: '/checklists/templates/:id', name: 'checklist-template', component: () => import('@/views/ChecklistTemplateView.vue'), meta: { title: 'Checklist template', requiresAccess: true } },
    { path: '/checklists/:id', name: 'checklist', component: () => import('@/views/ChecklistView.vue'), meta: { title: 'Checklist', requiresAccess: true } },
    { path: '/dashboard', name: 'dashboard', component: () => import('@/views/DashboardView.vue'), meta: { title: 'Dashboard', requiresAccess: true, wide: true } },
    { path: '/part-sorter', name: 'part-sorter', component: () => import('@/views/PartSorterView.vue'), meta: { title: 'Part sorter', requiresAccess: true, wide: true } },
    { path: '/milestones', name: 'milestones', component: () => import('@/views/MilestonesView.vue'), meta: { title: 'Milestones', requiresAccess: true } },
    { path: '/milestones/:id', name: 'milestone', component: () => import('@/views/MilestoneView.vue'), meta: { title: 'Milestone', requiresAccess: true } },
    { path: '/setup', name: 'setup', component: () => import('@/views/SetupView.vue'), meta: { title: 'Setup', requiresAccess: true, requiresLead: true } },
    { path: '/people', name: 'people', component: () => import('@/views/PeopleView.vue'), meta: { title: 'People', requiresAccess: true, requiresLead: true } },
    { path: '/login', name: 'login', component: LoginView, meta: { title: 'Sign in', guestOnly: true } },
    { path: '/register', name: 'register', component: RegisterView, meta: { title: 'Register', guestOnly: true } },
    // Passwords are reset on the hub; a reset link that still points here is
    // sent on to it.
    { path: '/reset-password', name: 'reset-password', component: HubResetRedirect, meta: { title: 'Reset password' } },
    // Signed in, but no Workshop role (yet).
    { path: '/pending', name: 'pending', component: PendingView, meta: { title: 'Waiting for approval' } },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
});

router.beforeEach(async (to, from) => {
  const auth = useAuthStore();
  if (!auth.loaded) await auth.refresh();

  if (to.meta.guestOnly && auth.isSignedIn) return { name: 'home' };
  if (to.meta.requiresAccess) {
    if (!auth.isSignedIn) return to.name === 'home' ? { name: 'login' } : { name: 'login', query: { redirect: to.fullPath } };
    if (!auth.hasAccess) return { name: 'pending' };
    if (to.meta.requiresLead && !auth.isLead) return { name: 'home' };
    // Names for people, components, and milestones, used everywhere.
    await useDirectoryStore().ensureLoaded();
  }
  if (to.name === 'pending' && (!auth.isSignedIn || auth.hasAccess)) return { name: 'home' };
  // The Part sorter is served cross-origin isolated (vercel.json), so its
  // part finder can use several CPU cores. That only takes hold on a full page
  // load, and the other pages shouldn't keep it (it blocks cross-origin images
  // without CORP headers), so going into or out of it loads the page afresh.
  const sorter = to.name === 'part-sorter';
  if (from.matched.length && sorter !== (from.name === 'part-sorter') && (sorter || window.crossOriginIsolated)) {
    window.location.assign(to.fullPath);
    return false;
  }
  return true;
});

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} | Workshop` : 'Workshop';
});

export default router;
