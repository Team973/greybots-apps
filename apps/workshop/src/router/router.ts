import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth-store';
import { useDirectoryStore } from '@/stores/directory-store';
import HomeView from '@/views/HomeView.vue';
import LoginView from '@/views/LoginView.vue';
import RegisterView from '@/views/RegisterView.vue';
import ResetPasswordView from '@/views/ResetPasswordView.vue';
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
    { path: '/tickets/:number(\\d+)', name: 'ticket', component: () => import('@/views/TicketView.vue'), meta: { title: 'Ticket', requiresAccess: true } },
    { path: '/sessions', name: 'sessions', component: () => import('@/views/SessionsView.vue'), meta: { title: 'Sessions', requiresAccess: true, wide: true } },
    { path: '/sessions/:id', name: 'session', component: () => import('@/views/SessionView.vue'), meta: { title: 'Session plan', requiresAccess: true } },
    { path: '/milestones', name: 'milestones', component: () => import('@/views/MilestonesView.vue'), meta: { title: 'Milestones', requiresAccess: true } },
    { path: '/milestones/:id', name: 'milestone', component: () => import('@/views/MilestoneView.vue'), meta: { title: 'Milestone', requiresAccess: true } },
    { path: '/points', name: 'points', component: () => import('@/views/PointsView.vue'), meta: { title: 'GreyPoints', requiresAccess: true } },
    { path: '/rewards', name: 'rewards', component: () => import('@/views/RewardsView.vue'), meta: { title: 'Rewards', requiresAccess: true } },
    { path: '/setup', name: 'setup', component: () => import('@/views/SetupView.vue'), meta: { title: 'Setup', requiresAccess: true, requiresLead: true } },
    { path: '/people', name: 'people', component: () => import('@/views/PeopleView.vue'), meta: { title: 'People', requiresAccess: true, requiresLead: true } },
    { path: '/login', name: 'login', component: LoginView, meta: { title: 'Sign in', guestOnly: true } },
    { path: '/register', name: 'register', component: RegisterView, meta: { title: 'Register', guestOnly: true } },
    // Reached from the link in a password reset email, which signs the person
    // in for long enough to choose a new password.
    { path: '/reset-password', name: 'reset-password', component: ResetPasswordView, meta: { title: 'Reset password' } },
    // Signed in, but no Workshop role (yet).
    { path: '/pending', name: 'pending', component: PendingView, meta: { title: 'Waiting for approval' } },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
});

router.beforeEach(async (to) => {
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
  return true;
});

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} | Workshop` : 'Workshop';
});

export default router;
