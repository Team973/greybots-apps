<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { fetchTemplate, saveTemplate, setTemplateArchived, type ChecklistTemplate, type StepDraft } from '@/lib/checklists';
import { formatDate } from '@/lib/dates';
import { errorMessage } from '@/lib/db';
import { useAuthStore } from '@/stores/auth-store';
import { useDirectoryStore } from '@/stores/directory-store';

// One checklist template: its name, what it's for, and its steps. Members and
// above write and edit them; everyone else reads them. Saving changes the
// template only: checklists already added to sessions keep the steps they
// were added with.
const auth = useAuthStore();
const directory = useDirectoryStore();
const route = useRoute();
const router = useRouter();

const isNew = computed(() => route.name === 'checklist-template-new');
const template = ref<ChecklistTemplate | null>(null);
const name = ref('');
const description = ref('');
const steps = ref<StepDraft[]>([]);
const loaded = ref(false);
const missing = ref(false);
const error = ref('');
const notice = ref('');
const busy = ref(false);
const dirty = ref(false);

async function load() {
  error.value = '';
  notice.value = '';
  loaded.value = false;
  missing.value = false;
  try {
    if (isNew.value) {
      template.value = null;
      name.value = '';
      description.value = '';
      steps.value = [{ title: '', details: '' }];
    } else {
      const found = await fetchTemplate(route.params.id as string);
      if (!found) {
        missing.value = true;
        return;
      }
      template.value = found.template;
      name.value = found.template.name;
      description.value = found.template.description;
      steps.value = found.steps.map((s) => ({ title: s.title, details: s.details }));
    }
    // After the watcher below has seen the loaded values.
    await nextTick();
    dirty.value = false;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loaded.value = true;
  }
}
// Only while on this page (not as it's left for another).
watch(
  () => route.fullPath,
  () => {
    if (route.name === 'checklist-template' || route.name === 'checklist-template-new') load();
  },
  { immediate: true }
);
watch([name, description, steps], () => (dirty.value = true), { deep: true });

const editable = computed(() => auth.isMember);

// Focus the new step's title, so steps can be typed one after another.
const list = ref<HTMLElement | null>(null);
async function addStep(at = steps.value.length) {
  steps.value.splice(at, 0, { title: '', details: '' });
  await nextTick();
  list.value?.querySelectorAll<HTMLInputElement>('input.step-title')[at]?.focus();
}
function removeStep(index: number) {
  steps.value.splice(index, 1);
}
function move(index: number, by: number) {
  const [moved] = steps.value.splice(index, 1);
  steps.value.splice(index + by, 0, moved);
}
// Enter in a step's title starts the next step.
function onTitleEnter(index: number) {
  addStep(index + 1);
}

async function save() {
  error.value = '';
  notice.value = '';
  busy.value = true;
  try {
    const id = await saveTemplate(template.value?.id ?? null, name.value, description.value, steps.value);
    if (isNew.value) {
      await router.replace(`/checklists/templates/${id}`);
    } else {
      await load();
    }
    notice.value = 'Saved. Checklists already on sessions keep the steps they were added with.';
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

async function toggleArchived() {
  if (!template.value) return;
  error.value = '';
  busy.value = true;
  try {
    await setTemplateArchived(template.value.id, !template.value.archived);
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="page">
    <RouterLink to="/checklists" class="back">← Checklists</RouterLink>
    <p v-if="error" class="error-text">{{ error }}</p>
    <p v-if="!loaded" class="empty">Loading…</p>
    <p v-else-if="missing" class="empty">That checklist doesn't exist.</p>

    <template v-else>
      <header class="page-header">
        <h1>{{ isNew ? 'New checklist' : template?.name }}</h1>
        <span v-if="template?.archived" class="chip">Archived</span>
        <p v-if="template" class="hint">
          Last changed {{ formatDate(template.updated_at) }}<template v-if="template.updated_by"> by {{ directory.personName(template.updated_by) }}</template>
        </p>
      </header>
      <p v-if="notice" class="success-text">{{ notice }}</p>

      <form class="panel" @submit.prevent="save">
        <label class="field">
          <span>Name</span>
          <input v-model="name" type="text" maxlength="120" placeholder="Pre-match check, End-of-night teardown…" :disabled="!editable" required />
        </label>
        <label class="field">
          <span>What it's for</span>
          <textarea v-model="description" rows="2" placeholder="When to use it, anything to know first" :disabled="!editable"></textarea>
        </label>

        <h2>Steps</h2>
        <p class="hint">Steps can be done in any order.</p>
        <ol ref="list" class="steps">
          <li v-for="(step, index) in steps" :key="index">
            <span class="number">{{ index + 1 }}</span>
            <div class="step-fields">
              <input
                v-model="step.title"
                class="control step-title"
                type="text"
                maxlength="200"
                placeholder="What to do"
                :aria-label="`Step ${index + 1}`"
                :disabled="!editable"
                @keydown.enter.prevent="onTitleEnter(index)"
              />
              <textarea
                v-if="editable || step.details"
                v-model="step.details"
                class="control details"
                rows="1"
                placeholder="Details (optional)"
                :aria-label="`Step ${index + 1} details`"
                :disabled="!editable"
              ></textarea>
            </div>
            <div v-if="editable" class="step-actions">
              <button type="button" class="icon-small" :disabled="index === 0" aria-label="Move up" @click="move(index, -1)">↑</button>
              <button type="button" class="icon-small" :disabled="index === steps.length - 1" aria-label="Move down" @click="move(index, 1)">↓</button>
              <button type="button" class="icon-small" :disabled="steps.length === 1" :aria-label="`Remove step ${index + 1}`" @click="removeStep(index)">×</button>
            </div>
          </li>
        </ol>

        <div v-if="editable" class="form-actions">
          <button type="button" class="button small" @click="addStep()">Add a step</button>
          <span class="actions-spacer"></span>
          <button v-if="template" type="button" class="button" :disabled="busy" @click="toggleArchived">{{ template.archived ? 'Restore' : 'Archive' }}</button>
          <button type="submit" class="button primary" :disabled="busy || (!dirty && !isNew)">{{ isNew ? 'Create' : 'Save' }}</button>
        </div>
      </form>
    </template>
  </div>
</template>

<style scoped>
.panel h2 {
  margin-top: 6px;
}

.steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.steps li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.number {
  flex: none;
  width: 24px;
  padding-top: 8px;
  text-align: right;
  opacity: 0.6;
}

.step-fields {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.details {
  font-size: 0.85rem;
  resize: vertical;
}

.step-actions {
  display: flex;
  gap: 4px;
  padding-top: 2px;
}

.icon-small {
  flex: none;
  width: 30px;
  height: 30px;
  border: 1px solid var(--accent-color);
  border-radius: 6px;
  background: transparent;
  color: var(--primary-text-color);
  font: inherit;
  cursor: pointer;
}

.icon-small:disabled {
  opacity: 0.3;
  cursor: default;
}

.form-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}
</style>
