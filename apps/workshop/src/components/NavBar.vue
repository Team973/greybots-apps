<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { roleLabels } from '@greybots/common/lib/user-roles';
import { useViewModeStore } from '@greybots/common/stores/view-mode-store';
import { useAuthStore } from '@/stores/auth-store';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const viewMode = useViewModeStore();
const toggleTheme = () => viewMode.setThemePreference(viewMode.isDarkMode ? 'light' : 'dark');

async function signOut() {
  menuOpen.value = false;
  await auth.signOut();
  router.push({ name: 'login' });
}

// The page links, shown as a strip when they all fit and as a hamburger menu
// when they don't.
const pages: { to: string; label: string; lead?: boolean }[] = [
  { to: '/', label: 'My tasks' },
  { to: '/tickets', label: 'Tickets' },
  { to: '/sessions', label: 'Sessions' },
  { to: '/milestones', label: 'Milestones' },
  { to: '/points', label: 'GreyPoints' },
  { to: '/rewards', label: 'Rewards' },
  { to: '/setup', label: 'Setup', lead: true },
  { to: '/people', label: 'People', lead: true }
];
const links = computed(() => (auth.hasAccess ? pages.filter((page) => !page.lead || auth.isLead) : []));
// "My tasks" is "/", which every path starts with, so it only matches exactly.
const isActive = (to: string) => (to === '/' ? route.path === '/' : route.path === to || route.path.startsWith(`${to}/`));

// Collapse to the menu whenever the strip can't show every link. The strip
// stays in the layout (just invisible) while collapsed, so it can still be
// measured and the bar expands again as soon as there's room.
const strip = ref<HTMLElement | null>(null);
const collapsed = ref(false);
const menuOpen = ref(false);
function measure() {
  const el = strip.value;
  if (!el) return;
  collapsed.value = el.scrollWidth > el.clientWidth + 1;
  if (!collapsed.value) menuOpen.value = false;
}
let observer: ResizeObserver | null = null;
onMounted(() => {
  measure();
  if (strip.value) {
    observer = new ResizeObserver(measure);
    observer.observe(strip.value);
  }
  window.addEventListener('resize', measure);
  document.addEventListener('keydown', onKeydown);
  // Capture phase, so it also sees clicks that something else stops.
  document.addEventListener('click', onOutsideClick, true);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  window.removeEventListener('resize', measure);
  document.removeEventListener('keydown', onKeydown);
  document.removeEventListener('click', onOutsideClick, true);
});
// A role change adds or removes links without resizing the strip.
watch(links, () => nextTick(measure));
watch(() => route.fullPath, () => (menuOpen.value = false));

const bar = ref<HTMLElement | null>(null);
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') menuOpen.value = false;
}
function onOutsideClick(event: MouseEvent) {
  if (menuOpen.value && bar.value && !bar.value.contains(event.target as Node)) menuOpen.value = false;
}
</script>

<template>
  <header ref="bar" class="nav">
    <button
      v-if="collapsed"
      class="nav-button menu-button"
      :aria-expanded="menuOpen"
      aria-controls="nav-menu"
      :aria-label="menuOpen ? 'Close menu' : 'Open menu'"
      @click="menuOpen = !menuOpen"
    >
      <span class="menu-icon" :class="{ open: menuOpen }" aria-hidden="true"><i></i><i></i><i></i></span>
    </button>
    <RouterLink to="/" class="brand">Workshop</RouterLink>
    <nav ref="strip" class="links" :class="{ collapsed }" aria-label="Pages" :aria-hidden="collapsed">
      <RouterLink
        v-for="page in links"
        :key="page.to"
        :to="page.to"
        class="nav-button"
        :class="{ active: isActive(page.to) }"
        :tabindex="collapsed ? -1 : undefined"
      >
        {{ page.label }}
      </RouterLink>
    </nav>
    <button
      class="nav-button theme-button"
      :aria-label="viewMode.isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'"
      :title="viewMode.isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'"
      @click="toggleTheme"
    >
      <span aria-hidden="true">{{ viewMode.isDarkMode ? '☀' : '☾' }}</span>
    </button>
    <span v-if="auth.hasAccess" class="user">
      {{ auth.name }} <span class="role">{{ roleLabels[auth.role] }}</span>
    </span>
    <template v-if="auth.loaded">
      <button v-if="auth.isSignedIn" class="nav-button" @click="signOut">Sign out</button>
      <RouterLink v-else to="/login" class="nav-button">Sign in</RouterLink>
    </template>

    <nav v-if="collapsed && menuOpen" id="nav-menu" class="menu" aria-label="Pages">
      <p v-if="auth.hasAccess" class="menu-user">
        {{ auth.name }} <span class="role">{{ roleLabels[auth.role] }}</span>
      </p>
      <RouterLink v-for="page in links" :key="page.to" :to="page.to" class="menu-link" :class="{ active: isActive(page.to) }" @click="menuOpen = false">
        {{ page.label }}
      </RouterLink>
    </nav>
  </header>
</template>

<style scoped>
.nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 64px;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  box-sizing: border-box;
  background-color: var(--header-color);
  color: var(--header-text-color);
}

.brand {
  color: inherit;
  text-decoration: none;
  font-size: 1.4rem;
  font-weight: 600;
}

.links {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  overflow: hidden;
}

/* Still laid out, so it can be measured, but out of sight and out of reach. */
.links.collapsed {
  visibility: hidden;
}

.user {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.role {
  opacity: 0.75;
  font-size: 0.85rem;
}

.nav-button {
  flex: none;
  padding: 8px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
}

.nav-button.active,
.nav-button:hover {
  background-color: var(--header-hover-color);
}

.theme-button {
  padding: 6px 10px;
  font-size: 1.15rem;
  line-height: 1;
}

/* Hamburger: three bars that become a cross while the menu is open. */
.menu-button {
  padding: 10px;
}

.menu-icon {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 22px;
  height: 16px;
}

.menu-icon i {
  display: block;
  height: 2px;
  border-radius: 2px;
  background: currentColor;
  transition: transform 0.15s, opacity 0.15s;
}

.menu-icon.open i:nth-child(1) {
  transform: translateY(7px) rotate(45deg);
}

.menu-icon.open i:nth-child(2) {
  opacity: 0;
}

.menu-icon.open i:nth-child(3) {
  transform: translateY(-7px) rotate(-45deg);
}

.menu {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 64px);
  padding: 4px 8px 12px;
  box-sizing: border-box;
  overflow-y: auto;
  background-color: var(--header-color);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.35);
}

.menu-user {
  margin: 0;
  padding: 8px 12px;
  opacity: 0.85;
}

/* Big enough to hit with a thumb. */
.menu-link {
  padding: 14px 12px;
  border-radius: 8px;
  color: inherit;
  font-size: 1.1rem;
  text-decoration: none;
}

.menu-link.active,
.menu-link:hover {
  background-color: var(--header-hover-color);
}

@media (max-width: 480px) {
  .nav {
    gap: 6px;
    padding: 0 8px;
  }

  .brand {
    font-size: 1.2rem;
  }
}

/* The name gives way to the page links first (it's in the menu instead). */
@media (max-width: 1300px) {
  .user {
    display: none;
  }
}
</style>
