<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import AppDialog from '@greybots/common/components/AppDialog.vue';
import PersonSearch from '@/components/PersonSearch.vue';
import {
  assignStep,
  canAssign,
  canChangeOwner,
  canRemove,
  canTick,
  fetchChecklist,
  progress,
  removeChecklist,
  runsChecklist,
  setOwner,
  setSignedOff,
  setStepDone,
  type ChecklistStep,
  type FullChecklist
} from '@/lib/checklists';
import { formatDay, formatSessionTime, formatTime } from '@/lib/dates';
import { errorMessage } from '@/lib/db';
import { useAuthStore } from '@/stores/auth-store';
import { useDirectoryStore } from '@/stores/directory-store';

// A checklist on a shop session. Steps are ticked off in any order by their
// assignee, the owner, or an admin, and each shows who did it and when. The
// owner (or an admin) hands steps to other people, and signs the checklist
// off once every step is done. Leads change the owner or take it off the
// session.
const auth = useAuthStore();
const directory = useDirectoryStore();
const route = useRoute();
const router = useRouter();

const checklist = ref<FullChecklist | null>(null);
const loaded = ref(false);
const error = ref('');
const busy = ref(false);

async function load() {
  error.value = '';
  try {
    checklist.value = await fetchChecklist(route.params.id as string);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loaded.value = true;
  }
}
// Only while on this page (not as it's left for a session's, which also has an id).
watch(
  () => route.params.id,
  () => {
    if (route.name === 'checklist') load();
  },
  { immediate: true }
);

const actor = computed(() => ({ userId: auth.userId, isMember: auth.isMember, isLead: auth.isLead, isAdmin: auth.isAdmin }));
const status = computed(() => (checklist.value ? progress(checklist.value) : { done: 0, total: 0, complete: false }));
const runs = computed(() => !!checklist.value && runsChecklist(checklist.value, actor.value));
const assignable = computed(() => !!checklist.value && canAssign(checklist.value, actor.value));

async function act(action: () => Promise<unknown>) {
  error.value = '';
  busy.value = true;
  try {
    await action();
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

const tick = (step: ChecklistStep) => act(() => setStepDone(step.id, !step.completed_at));
const assign = (step: ChecklistStep, userId: string) => act(() => assignStep(step.id, userId));
const signOff = () => act(() => setSignedOff(checklist.value!.id, true));
const undoSignOff = () => act(() => setSignedOff(checklist.value!.id, false));

// "Done by Sam · Tue, Oct 14, 6:42 PM"
const doneText = (step: ChecklistStep) =>
  `Done by ${directory.personName(step.completed_by)} · ${formatDay(step.completed_at!)}, ${formatTime(step.completed_at!)}`;

// Which step's assignee is being changed.
const assigning = ref<string | null>(null);

// --- Leads: owner, and taking it off the session ---
const changingOwner = ref(false);
function pickOwner(userId: string) {
  changingOwner.value = false;
  return act(() => setOwner(checklist.value!.id, userId));
}

const confirmingRemove = ref(false);
async function remove() {
  confirmingRemove.value = false;
  const sessionId = checklist.value!.session_id;
  error.value = '';
  busy.value = true;
  try {
    await removeChecklist(checklist.value!.id);
    await router.replace(`/sessions/${sessionId}`);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="page">
    <RouterLink v-if="checklist?.session" :to="`/sessions/${checklist.session_id}`" class="back">← {{ checklist.session.title }}</RouterLink>
    <RouterLink v-else to="/checklists" class="back">← Checklists</RouterLink>
    <p v-if="error" class="error-text">{{ error }}</p>
    <p v-if="!loaded" class="empty">Loading…</p>
    <p v-else-if="!checklist" class="empty">That checklist doesn't exist (it may have been taken off its session).</p>

    <template v-else>
      <header class="page-header">
        <h1>{{ checklist.name }}</h1>
        <span class="muted">{{ status.done }} of {{ status.total }} done</span>
        <p v-if="checklist.session" class="hint">
          {{ checklist.session.title }} · {{ formatSessionTime(checklist.session.starts_at, checklist.session.ends_at) }}
        </p>
      </header>
      <p v-if="checklist.description" class="description">{{ checklist.description }}</p>

      <section class="panel owner-panel">
        <div class="owner">
          <span class="muted">Owner</span>
          <strong>{{ directory.personName(checklist.owner_id) }}</strong>
          <template v-if="canChangeOwner(checklist, actor)">
            <button v-if="!changingOwner" class="button small" :disabled="busy" @click="changingOwner = true">Change</button>
            <PersonSearch
              v-else
              members-only
              autofocus
              label="New owner"
              placeholder="Type a name…"
              :exclude="checklist.owner_id ? [checklist.owner_id] : []"
              @pick="pickOwner"
              @keydown.esc="changingOwner = false"
              @focusout="changingOwner = false"
            />
          </template>
        </div>

        <div v-if="checklist.signed_off_at" class="signed-off">
          <span>
            ✓ Signed off by <strong>{{ directory.personName(checklist.signed_off_by) }}</strong> ·
            {{ formatDay(checklist.signed_off_at) }}, {{ formatTime(checklist.signed_off_at) }}
          </span>
          <button v-if="runs" class="button small" :disabled="busy" @click="undoSignOff">Undo sign-off</button>
        </div>
        <div v-else-if="runs" class="sign-off">
          <button class="button primary" :disabled="busy || !status.complete" @click="signOff">Sign off</button>
          <span class="muted">{{ status.complete ? 'Every step is done.' : `Every step has to be done first (${status.total - status.done} to go).` }}</span>
        </div>
        <p v-else-if="status.complete" class="muted">Every step is done; waiting for {{ directory.personName(checklist.owner_id) }} or an admin to sign it off.</p>
      </section>

      <section class="panel">
        <h2>Steps</h2>
        <ul class="steps">
          <li v-for="step in checklist.steps" :key="step.id" :class="{ done: !!step.completed_at, mine: step.assignee_id === auth.userId }">
            <label class="tick">
              <input
                type="checkbox"
                :checked="!!step.completed_at"
                :disabled="busy || !canTick(checklist, step, actor)"
                :aria-label="`${step.completed_at ? 'Untick' : 'Tick off'} ${step.title}`"
                @change="tick(step)"
              />
            </label>
            <div class="step-main">
              <span class="step-title">{{ step.title }}</span>
              <span v-if="step.details" class="details muted">{{ step.details }}</span>
              <span v-if="step.completed_at" class="done-by">{{ doneText(step) }}</span>
            </div>
            <div class="assignee">
              <template v-if="assigning === step.id">
                <PersonSearch
                  members-only
                  autofocus
                  label="Assign to"
                  placeholder="Type a name…"
                  :exclude="step.assignee_id ? [step.assignee_id] : []"
                  @pick="(id) => ((assigning = null), assign(step, id))"
                  @keydown.esc="assigning = null"
                  @focusout="assigning = null"
                />
              </template>
              <button
                v-else-if="assignable && !step.completed_at"
                class="chip person"
                :disabled="busy"
                :title="`Assigned to ${directory.personName(step.assignee_id)}; click to change`"
                @click="assigning = step.id"
              >
                {{ directory.personName(step.assignee_id) }} ▾
              </button>
              <span v-else class="chip person" :title="`Assigned to ${directory.personName(step.assignee_id)}`">{{ directory.personName(step.assignee_id) }}</span>
            </div>
          </li>
        </ul>
      </section>

      <div v-if="canRemove(checklist, actor)" class="remove">
        <button class="button small danger" :disabled="busy" @click="confirmingRemove = true">Take off this session</button>
      </div>
    </template>

    <AppDialog :open="confirmingRemove" title="Take this checklist off the session?" @close="confirmingRemove = false">
      <p>
        <strong>{{ checklist?.name }}</strong> and the steps ticked off on it ({{ status.done }} of {{ status.total }}) will be deleted. The template isn't changed.
      </p>
      <template #actions>
        <button class="button" @click="confirmingRemove = false">Keep it</button>
        <button class="button danger" @click="remove">Take it off</button>
      </template>
    </AppDialog>
  </div>
</template>

<style scoped>
.description {
  margin: 0;
  white-space: pre-wrap;
}

.owner-panel {
  gap: 12px;
}

.owner,
.signed-off,
.sign-off {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
}

.signed-off {
  color: var(--stage-in_progress);
}

.steps {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.steps li {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-left: 4px solid transparent;
}

.steps li.mine:not(.done) {
  border-left-color: var(--header-color);
}

.tick input {
  width: 22px;
  height: 22px;
  margin: 1px 0 0;
  cursor: pointer;
}

.tick input:disabled {
  cursor: default;
}

.step-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.step-title {
  overflow-wrap: anywhere;
}

.done .step-title {
  text-decoration: line-through;
  opacity: 0.65;
}

.details {
  font-size: 0.85rem;
  white-space: pre-wrap;
}

.done-by {
  font-size: 0.8rem;
  color: var(--stage-in_progress);
}

.assignee {
  display: flex;
  justify-content: flex-end;
  flex: none;
  max-width: 50%;
}

button.chip {
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.78rem;
  cursor: pointer;
}

button.chip:hover:not(:disabled) {
  border-color: var(--header-color);
}

.remove {
  display: flex;
  justify-content: flex-end;
}

@media (max-width: 560px) {
  .steps li {
    flex-wrap: wrap;
  }

  .assignee {
    max-width: none;
    flex-basis: 100%;
    justify-content: flex-start;
    padding-left: 32px;
  }
}
</style>
