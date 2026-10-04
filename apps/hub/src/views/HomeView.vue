<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import AccountPending from '@greybots/common/components/AccountPending.vue';
import { hasAppAccess, roleLabels, type AppRole } from '@greybots/common/lib/user-roles';
import { hubApps, type HubApp } from '@/lib/apps';
import { useAuthStore } from '@/stores/auth-store';

// The launcher: one big button per greybots app, each with this person's role
// in it. Only for signed-in accounts (the router sends everyone else to the
// sign-in), and the buttons only for an account with a role somewhere.
const auth = useAuthStore();
const router = useRouter();

function roleIn(app: HubApp): AppRole | null {
  if (!auth.profile) return null;
  return auth.profile[app.roleColumn] ?? 'pending';
}

const apps = computed(() =>
  hubApps.map((app) => {
    const role = roleIn(app);
    return {
      ...app,
      // What to say under the app's name about this person's access.
      access: role === null ? null : hasAppAccess(role) ? `You're ${role === 'admin' ? 'an' : 'a'} ${roleLabels[role].toLowerCase()}` : 'No access yet: ask a lead or admin',
      noAccess: role !== null && !hasAppAccess(role)
    };
  })
);

// An account with no role anywhere: say so, in place of the buttons.
const waiting = computed(() => !auth.hasAccess);
const checking = ref(false);
async function refresh() {
  checking.value = true;
  try {
    await auth.refresh();
  } finally {
    checking.value = false;
  }
}

async function signOut() {
  await auth.signOut();
  router.push({ name: 'login' });
}
</script>

<template>
  <div class="home">
    <header class="welcome">
      <h1>{{ auth.hasAccess ? `Hi, ${auth.name}` : 'Greybots apps' }}</h1>
      <p v-if="!waiting" class="hint">Team 973's apps, in one place. Pick the one you need.</p>
    </header>

    <div v-if="waiting" class="card notice">
      <AccountPending app-name="the greybots apps" :name="auth.profile?.name" :deactivated="auth.status === 'deactivated'" :checking="checking" @refresh="refresh" @sign-out="signOut" />
    </div>

    <nav v-else class="apps" aria-label="Apps">
      <component
        :is="app.url ? 'a' : 'div'"
        v-for="app in apps"
        :key="app.key"
        class="app-button"
        :class="[app.key, { 'no-access': app.noAccess, unset: !app.url }]"
        :href="app.url || undefined"
      >
        <span class="app-name">{{ app.name }}</span>
        <span class="app-description">{{ app.description }}</span>
        <span v-if="!app.url" class="app-access">Address not set up yet</span>
        <span v-else-if="app.access" class="app-access">{{ app.access }}</span>
      </component>

      <RouterLink to="/people" class="app-button people">
        <span class="app-name">People</span>
        <span class="app-description">Approve new accounts and set everyone's role in each app</span>
      </RouterLink>
    </nav>

  </div>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  width: 100%;
  max-width: 720px;
}

.welcome {
  text-align: center;
}

.welcome h1 {
  margin: 0 0 4px;
  font-size: clamp(1.6rem, 5vw, 2.2rem);
  font-weight: 600;
}

.notice {
  max-width: none;
}

.apps {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
}

/* Giant, thumb-friendly buttons: the whole block is the link. */
.app-button {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  min-height: 132px;
  padding: 24px 28px;
  border-radius: 18px;
  background: var(--header-color);
  color: #fff;
  text-decoration: none;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
  touch-action: manipulation;
  transition: transform 0.1s, filter 0.15s;
}

.app-button:hover {
  filter: brightness(1.1);
}

.app-button:active {
  transform: scale(0.985);
}

.app-button.preflight {
  background: #1565c0;
}

.app-button.people {
  min-height: 96px;
  background: var(--tile-background-color);
  color: var(--primary-text-color);
  border: 2px solid var(--header-color);
  box-shadow: none;
}

.app-name {
  font-size: clamp(1.7rem, 6vw, 2.4rem);
  font-weight: 700;
  line-height: 1.1;
}

.people .app-name {
  font-size: clamp(1.3rem, 4.5vw, 1.7rem);
}

.app-description {
  font-size: 1.05rem;
  opacity: 0.9;
}

.app-access {
  margin-top: 6px;
  font-size: 0.9rem;
  font-weight: 600;
  opacity: 0.85;
}

/* Still a link (the app has its own sign-in), but visibly not for them yet. */
.app-button.no-access {
  filter: saturate(0.35);
}

.app-button.unset {
  filter: grayscale(1);
  opacity: 0.6;
  cursor: default;
}
</style>
