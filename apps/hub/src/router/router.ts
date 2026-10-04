import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth-store';
import HomeView from '@/views/HomeView.vue';
import LoginView from '@/views/LoginView.vue';
import PeopleView from '@/views/PeopleView.vue';
import RegisterView from '@/views/RegisterView.vue';
import ResetPasswordView from '@/views/ResetPasswordView.vue';

declare module 'vue-router' {
  interface RouteMeta {
    title?: string;
    // Needs a signed-in account.
    requiresSignIn?: boolean;
    // Needs a signed-in account with a role in at least one app.
    requiresAccess?: boolean;
    // Only for people who aren't signed in.
    guestOnly?: boolean;
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // The launcher is behind the sign-in: the apps aren't shown to anyone
    // without an account.
    { path: '/', name: 'home', component: HomeView, meta: { title: 'Home', requiresSignIn: true } },
    { path: '/login', name: 'login', component: LoginView, meta: { title: 'Sign in', guestOnly: true } },
    { path: '/register', name: 'register', component: RegisterView, meta: { title: 'Register', guestOnly: true } },
    // Reached from the link in a password reset email, which signs the person
    // in for long enough to choose a new password.
    { path: '/reset-password', name: 'reset-password', component: ResetPasswordView, meta: { title: 'Reset password' } },
    { path: '/people', name: 'people', component: PeopleView, meta: { title: 'People', requiresAccess: true } },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.loaded) await auth.refresh();

  if (to.meta.guestOnly && auth.isSignedIn) return { name: 'home' };
  if ((to.meta.requiresSignIn || to.meta.requiresAccess) && !auth.isSignedIn) {
    // Plain /login for the home page; anywhere else comes back after sign-in.
    return to.name === 'home' ? { name: 'login' } : { name: 'login', query: { redirect: to.fullPath } };
  }
  if (to.meta.requiresAccess) {
    // Pending and deactivated accounts get the home page, which tells them
    // where they stand.
    if (!auth.hasAccess) return { name: 'home' };
  }
  return true;
});

router.afterEach((to) => {
  document.title = to.meta.title && to.name !== 'home' ? `${to.meta.title} | Greybots` : 'Greybots';
});

export default router;
