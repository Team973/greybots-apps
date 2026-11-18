<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import ChecklistRow from '@/components/ChecklistRow.vue';
import { fetchOpenChecklists, fetchTemplateStepCounts, fetchTemplates, setTemplateArchived, type ChecklistTemplate, type FullChecklist } from '@/lib/checklists';
import { errorMessage } from '@/lib/db';
import { useAuthStore } from '@/stores/auth-store';

// Checklists: the templates the team keeps (members and above write and edit
// them), and every checklist on a session that isn't signed off yet. Leads add
// checklists to sessions from the session's page.
const auth = useAuthStore();

const templates = ref<ChecklistTemplate[]>([]);
const stepCounts = ref<Map<string, number>>(new Map());
const open = ref<FullChecklist[]>([]);
const loaded = ref(false);
const error = ref('');
const busy = ref(false);

const active = computed(() => templates.value.filter((t) => !t.archived));
const archived = computed(() => templates.value.filter((t) => t.archived));

async function load() {
  error.value = '';
  try {
    const [t, counts, o] = await Promise.all([fetchTemplates(), fetchTemplateStepCounts(), fetchOpenChecklists()]);
    templates.value = t;
    stepCounts.value = counts;
    open.value = o;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loaded.value = true;
  }
}
onMounted(load);

async function archive(template: ChecklistTemplate, value: boolean) {
  error.value = '';
  busy.value = true;
  try {
    await setTemplateArchived(template.id, value);
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

const steps = (template: ChecklistTemplate) => {
  const n = stepCounts.value.get(template.id) ?? 0;
  return `${n} ${n === 1 ? 'step' : 'steps'}`;
};
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1>Checklists</h1>
      <RouterLink v-if="auth.isMember" to="/checklists/templates/new" class="button primary">New checklist</RouterLink>
      <p class="hint">
        Lists of steps the team keeps, separate from tickets. Leads add one to a shop session (on the session's page) with an owner, who hands its steps out; steps are
        done in any order, and the owner or an admin signs it off once they all are.
      </p>
    </header>
    <p v-if="error" class="error-text">{{ error }}</p>
    <p v-if="!loaded" class="empty">Loading…</p>

    <template v-else>
      <section class="panel">
        <div class="panel-header">
          <h2>In progress</h2>
          <span class="muted">{{ open.length }} not signed off</span>
        </div>
        <ul v-if="open.length" class="list">
          <ChecklistRow v-for="checklist in open" :key="checklist.id" :checklist="checklist" show-session />
        </ul>
        <p v-else class="empty">No checklists on any session are waiting to be finished.</p>
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2>Templates</h2>
        </div>
        <ul v-if="active.length" class="templates">
          <li v-for="template in active" :key="template.id">
            <RouterLink :to="`/checklists/templates/${template.id}`" class="name">{{ template.name }}</RouterLink>
            <span class="muted">{{ steps(template) }}</span>
            <span v-if="template.description" class="description muted">{{ template.description }}</span>
            <button v-if="auth.isMember" class="button small archive" :disabled="busy" @click="archive(template, true)">Archive</button>
          </li>
        </ul>
        <p v-else class="empty">No checklists yet.<template v-if="auth.isMember"> Start one with New checklist.</template></p>

        <details v-if="archived.length" class="archived">
          <summary>Archived ({{ archived.length }})</summary>
          <ul class="templates">
            <li v-for="template in archived" :key="template.id">
              <RouterLink :to="`/checklists/templates/${template.id}`" class="name">{{ template.name }}</RouterLink>
              <span class="muted">{{ steps(template) }}</span>
              <button v-if="auth.isMember" class="button small archive" :disabled="busy" @click="archive(template, false)">Restore</button>
            </li>
          </ul>
        </details>
      </section>
    </template>
  </div>
</template>

<style scoped>
.list,
.templates {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.templates li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(128, 128, 128, 0.25);
}

.name {
  color: inherit;
  font-weight: 600;
}

.description {
  flex-basis: 100%;
  order: 3;
  font-size: 0.85rem;
  white-space: pre-wrap;
}

.archive {
  margin-left: auto;
}

.archived summary {
  cursor: pointer;
  opacity: 0.8;
  margin-bottom: 6px;
}
</style>
