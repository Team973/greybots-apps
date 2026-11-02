<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import type { SignalLogFile } from '@shared/ipc';
import { templateKeys, viewKeys, type ReportTemplate, type SavedView, type SignalMapping } from '@shared/library';
import { matchKey, suggestKeys } from '@shared/signal-match';
import type { SignalInfo } from '@shared/signals';

// A robot's own names for the signals views and templates ask for. Each is
// shown as it's found in one of that robot's logs (by name, by the end of
// its path, or as mapped), with the likeliest signals to choose from where
// it isn't, or flagged as one the robot hasn't.

const props = defineProps<{
  robot: string;
  mapping: SignalMapping | null;
  logs: SignalLogFile[];
  views: SavedView[];
  templates: ReportTemplate[];
}>();

const emit = defineEmits<{
  save: [fields: Record<string, string | null>];
}>();

const fields = ref<Record<string, string | null>>({ ...(props.mapping?.fields ?? {}) });
watch(() => props.mapping, (m) => { fields.value = { ...(m?.fields ?? {}) }; });

// That robot's logs, those with a data log first (they have the most signals), newest first.
const robotLogs = computed(() => props.logs
  .filter((log) => log.robot === props.robot)
  .sort((a, b) => Number(!a.localPath) - Number(!b.localPath) || b.recorded.localeCompare(a.recorded)));
const logId = ref('');
watch(robotLogs, (list) => { if (!list.some((l) => l.id === logId.value)) logId.value = list[0]?.id ?? ''; }, { immediate: true });

// Whose signals: every template's and view's, or one's.
const source = ref('all');
const wanted = computed(() => {
  const keys = new Set<string>();
  for (const template of props.templates) {
    if (source.value === 'all' || source.value === template.id) for (const key of templateKeys(template.sections, template.scope)) keys.add(key);
  }
  for (const view of props.views) {
    if (source.value === 'all' || source.value === view.id) for (const key of viewKeys(view)) keys.add(key);
  }
  return [...keys].sort();
});

const signals = ref<SignalInfo[]>([]);
const loading = ref(false);
const problem = ref('');
watch(logId, async (id) => {
  signals.value = [];
  if (!id) return;
  loading.value = true;
  try {
    const summary = await window.diagnostics.openSignalLog(id);
    if (logId.value === id) signals.value = summary.signals.filter((s) => s.count !== 0);
  } catch (error) {
    problem.value = (error as Error).message;
  } finally {
    loading.value = false;
  }
}, { immediate: true });

const available = computed(() => signals.value.map((s) => s.key));

const rows = computed(() => wanted.value.map((key) => {
  const match = matchKey(key, available.value, fields.value);
  const how = match.flagged ? 'Flagged: not on this robot' : match.how === 'mapped' ? 'Mapped' : match.how === 'exact' ? 'Same name' : match.how === 'suffix' ? 'Same path end' : match.ambiguous.length ? `${match.ambiguous.length} fit equally` : 'Not found';
  const suggestions = match.key && match.how !== 'mapped' ? [] : suggestKeys(key, signals.value, { limit: 6 }).map((s) => s.key);
  return { key, match, how, suggestions, choice: Object.prototype.hasOwnProperty.call(fields.value, key) ? (fields.value[key] === null ? '__none' : fields.value[key]!) : '' };
}));

const unresolved = computed(() => rows.value.filter((r) => !r.match.key && !r.match.flagged).length);

function choose(key: string, value: string) {
  const next = { ...fields.value };
  if (value === '') delete next[key];
  else next[key] = value === '__none' ? null : value;
  fields.value = next;
}
</script>

<template>
  <div class="mapping">
    <div class="pickers">
      <label>
        <span class="hint small">Signals from</span>
        <select v-model="logId" aria-label="A log of this robot's">
          <option v-if="robotLogs.length === 0" value="">No logs of {{ robot }} here</option>
          <option v-for="log in robotLogs" :key="log.id" :value="log.id">{{ log.name }}</option>
        </select>
      </label>
      <label>
        <span class="hint small">Asked for by</span>
        <select v-model="source" aria-label="Whose signals">
          <option value="all">Every template and view</option>
          <optgroup label="Templates">
            <option v-for="t in templates" :key="t.id" :value="t.id">{{ t.name }}</option>
          </optgroup>
          <optgroup label="Views">
            <option v-for="v in views" :key="v.id" :value="v.id">{{ v.name }}</option>
          </optgroup>
        </select>
      </label>
    </div>
    <p v-if="problem" class="error-text small">{{ problem }}</p>
    <p v-if="loading" class="hint small">Reading the log…</p>
    <p v-else-if="wanted.length === 0" class="hint small">No templates or views ask for any signals yet.</p>
    <p v-else class="hint small">
      {{ wanted.length - unresolved }} of {{ wanted.length }} found{{ unresolved ? `; ${unresolved} to choose or flag` : '' }}.
    </p>

    <table v-if="wanted.length" id="mapping-table" class="plain">
      <thead>
        <tr><th>Asked for</th><th>Found</th><th>On {{ robot }}</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.key" :class="{ unresolved: !row.match.key && !row.match.flagged }">
          <td class="key">{{ row.key }}</td>
          <td class="small">{{ row.how }}<span v-if="row.match.key && row.match.how !== 'exact'" class="hint"><br />{{ row.match.key }}</span></td>
          <td>
            <select :value="row.choice" :aria-label="`Signal for ${row.key}`" @change="choose(row.key, ($event.target as HTMLSelectElement).value)">
              <option value="">{{ row.match.key && row.match.how !== 'mapped' ? 'As found' : 'Not chosen' }}</option>
              <option value="__none">Not on this robot (flag it)</option>
              <optgroup v-if="row.suggestions.length" label="Likeliest">
                <option v-for="key in row.suggestions" :key="key" :value="key">{{ key }}</option>
              </optgroup>
              <optgroup label="Every signal">
                <option v-for="key in available" :key="key" :value="key">{{ key }}</option>
              </optgroup>
            </select>
          </td>
        </tr>
      </tbody>
    </table>
    <div class="actions">
      <button id="save-mapping" class="small-button primary" @click="emit('save', fields)">Save the mapping</button>
    </div>
  </div>
</template>

<style scoped>
.mapping {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pickers {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.pickers label {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

select {
  max-width: 100%;
  padding: 4px 6px;
  border: 1px solid rgba(127, 127, 127, 0.6);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
}

select option {
  background: var(--tile-background-color, Canvas);
}

td select {
  width: 100%;
}

.key {
  overflow-wrap: anywhere;
  font-family: ui-monospace, Consolas, Menlo, monospace;
  font-size: 0.85rem;
}

.unresolved .key {
  color: #c98500;
}

.small {
  font-size: 0.85rem;
}

.small-button {
  padding: 5px 12px;
  border: 1px solid rgba(127, 127, 127, 0.6);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.small-button.primary {
  border-color: #2a78d6;
  background: color-mix(in srgb, #2a78d6 18%, transparent);
}
</style>
