<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { formatSessionTime } from '@/lib/dates';
import { openStepsFor, progress, type FullChecklist } from '@/lib/checklists';
import { useAuthStore } from '@/stores/auth-store';
import { useDirectoryStore } from '@/stores/directory-store';

// One checklist on a session, in a list: its name, how far along it is, who
// owns it, and how many of its open steps are yours. The whole row opens it
// (like TicketRow); the `actions` slot sits above that.
const props = withDefaults(defineProps<{ checklist: FullChecklist; showSession?: boolean }>(), { showSession: false });

const auth = useAuthStore();
const directory = useDirectoryStore();

const status = computed(() => progress(props.checklist));
const mineOpen = computed(() => openStepsFor(props.checklist, auth.userId).length);
const owned = computed(() => !!auth.userId && props.checklist.owner_id === auth.userId);
const mine = computed(() => owned.value || mineOpen.value > 0);
</script>

<template>
  <li class="checklist-row" :class="{ mine, signed: !!checklist.signed_off_at }">
    <div class="main">
      <RouterLink :to="`/checklists/${checklist.id}`" class="title">{{ checklist.name }}</RouterLink>
      <div class="meta">
        <span v-if="checklist.signed_off_at" class="chip signed-off">Signed off</span>
        <span v-else-if="status.complete" class="chip ready">Ready to sign off</span>
        <span class="progress" :aria-label="`${status.done} of ${status.total} steps done`">
          <span class="bar"><i :style="{ width: `${status.total ? (status.done / status.total) * 100 : 0}%` }"></i></span>
          {{ status.done }} of {{ status.total }}
        </span>
        <span v-if="mineOpen" class="chip yours">{{ mineOpen }} yours</span>
        <span v-if="showSession && checklist.session" class="chip">{{ checklist.session.title }} · {{ formatSessionTime(checklist.session.starts_at, checklist.session.ends_at) }}</span>
      </div>
      <div class="people muted">Owner {{ directory.personName(checklist.owner_id) }}</div>
    </div>
    <div v-if="$slots.actions" class="actions">
      <slot name="actions" />
    </div>
  </li>
</template>

<style scoped>
.checklist-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-left: 4px solid transparent;
  list-style: none;
}

.checklist-row.mine {
  border-left-color: var(--header-color);
}

.checklist-row.signed .title {
  opacity: 0.65;
}

.main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.title {
  color: inherit;
  font-weight: 600;
  text-decoration: none;
  overflow-wrap: anywhere;
}

/* Stretched over the whole row, so anywhere on it opens the checklist. */
.title::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
}

.checklist-row:hover {
  background: rgba(128, 128, 128, 0.08);
}

.checklist-row:hover .title {
  text-decoration: underline;
}

.title:focus-visible {
  outline: none;
}

.title:focus-visible::after {
  outline: 2px solid var(--header-hover-color);
  outline-offset: -2px;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
}

.progress {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
}

.bar {
  display: inline-block;
  width: 64px;
  height: 6px;
  border-radius: 3px;
  background: rgba(128, 128, 128, 0.25);
  overflow: hidden;
}

.bar i {
  display: block;
  height: 100%;
  background: var(--stage-in_progress);
}

.chip.signed-off {
  border-color: var(--stage-closed);
  color: var(--stage-closed);
}

.chip.ready {
  border-color: var(--stage-in_progress);
  color: var(--stage-in_progress);
}

.chip.yours {
  border-color: var(--header-color);
}

.people {
  font-size: 0.85rem;
}

.actions {
  position: relative;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

@media (max-width: 560px) {
  .checklist-row {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
