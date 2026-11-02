<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import '@material/web/button/filled-button';
import '@material/web/button/outlined-button';

import type { AccountStatus } from '@shared/account';
import { formatTime } from '@/format';

// Signing in to a greybots-apps account shares the library (views,
// templates, pipelines, robot mappings) with the team (#148).

const account = ref<AccountStatus | null>(null);
const email = ref('');
const password = ref('');
const busy = ref(false);

const roleNames: Record<string, string> = {
  admin: 'admin', lead: 'lead', member: 'member', observer: 'observer', pending: 'no role yet', deactivated: 'deactivated'
};

async function refresh() {
  account.value = await window.diagnostics.getAccount().catch(() => account.value);
}

async function signIn() {
  busy.value = true;
  try {
    account.value = await window.diagnostics.signIn(email.value, password.value);
    if (account.value.signedIn) password.value = '';
  } finally {
    busy.value = false;
  }
}

async function signOut() {
  account.value = await window.diagnostics.signOut();
}

async function sync() {
  busy.value = true;
  try {
    account.value = await window.diagnostics.syncLibrary();
  } finally {
    busy.value = false;
  }
}

let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  refresh();
  timer = setInterval(refresh, 3000);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <section id="account-section" class="card">
    <h2>Team account</h2>
    <p class="hint">
      Signed in with a greybots-apps account, saved views, report templates, pipelines and robot mappings are shared with the team, and
      theirs come here. Members and above share; only leads and admins delete what's shared. Reports and notes stay on this computer.
    </p>
    <template v-if="account?.signedIn">
      <p id="account-who">
        Signed in as <strong>{{ account.name ?? account.email }}</strong>
        <span class="hint">({{ account.email }}) · Diagnostics {{ roleNames[account.role ?? 'pending'] }}</span>
      </p>
      <p class="hint small">
        {{ account.syncing ? 'Syncing…' : account.lastSync ? `Synced ${formatTime(account.lastSync)}` : 'Not synced yet.' }}
      </p>
      <div class="card-actions">
        <md-outlined-button id="sync-now" :disabled="busy || account.syncing" @click="sync">Sync now</md-outlined-button>
        <md-outlined-button id="sign-out" @click="signOut">Sign out</md-outlined-button>
      </div>
    </template>
    <form v-else id="sign-in" class="sign-in" @submit.prevent="signIn">
      <input v-model="email" type="email" name="email" autocomplete="username" placeholder="Email" aria-label="Email" required />
      <input v-model="password" type="password" name="password" autocomplete="current-password" placeholder="Password" aria-label="Password" required />
      <md-filled-button type="submit" :disabled="busy || !email || !password" @click="signIn">{{ busy ? 'Signing in…' : 'Sign in' }}</md-filled-button>
    </form>
    <p v-if="account?.problem" id="account-problem" class="error-text small">{{ account.problem }}</p>
    <p v-if="account && !account.signedIn" class="hint small">
      Accounts are made in the other greybots apps (GreyScout, Preflight); a lead or admin gives each a Diagnostics role on the People page.
    </p>
  </section>
</template>

<style scoped>
.sign-in {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.sign-in input {
  flex: 1;
  min-width: 180px;
  padding: 8px 10px;
  border: 1px solid rgba(127, 127, 127, 0.6);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
}

#account-who {
  margin: 0;
}

.small {
  font-size: 0.85rem;
}
</style>
