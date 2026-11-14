<script lang="ts">
// Ids for the list and its options, unique per box on the page.
let count = 0;
</script>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useDirectoryStore, type Person } from '@/stores/directory-store';

// Type to find someone with a Workshop role, then Enter (or click) to pick
// them: a combobox, so the arrow keys move through the matches. Escape closes
// the list first (and only then reaches whatever's around it).
const props = withDefaults(defineProps<{ exclude?: string[]; placeholder?: string; label: string }>(), {
  exclude: () => [],
  placeholder: 'Type a name…'
});
const emit = defineEmits<{ pick: [userId: string] }>();

const directory = useDirectoryStore();
const query = ref('');
const open = ref(false);
const active = ref(0);
const id = `person-search-${++count}`;

// Names starting with what's typed first, then names containing it anywhere.
const matches = computed<Person[]>(() => {
  const q = query.value.trim().toLowerCase();
  const people = directory.assignable.filter((p) => !props.exclude.includes(p.user_id));
  if (!q) return people;
  const starts = people.filter((p) => p.name.toLowerCase().startsWith(q) || p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)));
  const contains = people.filter((p) => !starts.includes(p) && p.name.toLowerCase().includes(q));
  return [...starts, ...contains];
});

function show() {
  open.value = true;
  active.value = 0;
}
function pick(person: Person | undefined) {
  if (!person) return;
  emit('pick', person.user_id);
  query.value = '';
  active.value = 0;
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    if (!open.value) show();
    else active.value = Math.min(matches.value.length - 1, active.value + 1);
  } else if (event.key === 'ArrowUp') {
    active.value = Math.max(0, active.value - 1);
  } else if (event.key === 'Enter') {
    if (open.value && matches.value.length) pick(matches.value[active.value]);
  } else if (event.key === 'Escape') {
    if (!open.value) return;
    open.value = false;
    event.stopPropagation();
  } else {
    return;
  }
  event.preventDefault();
}
</script>

<template>
  <div class="person-search">
    <input
      v-model="query"
      type="text"
      class="control"
      role="combobox"
      autocomplete="off"
      :aria-label="label"
      :aria-expanded="open"
      :aria-controls="`${id}-list`"
      :aria-activedescendant="open && matches.length ? `${id}-${active}` : undefined"
      :placeholder="placeholder"
      @focus="show"
      @input="show"
      @blur="open = false"
      @keydown="onKeydown"
    />
    <ul v-if="open" :id="`${id}-list`" class="results" role="listbox" :aria-label="label">
      <li
        v-for="(person, i) in matches"
        :id="`${id}-${i}`"
        :key="person.user_id"
        role="option"
        :aria-selected="i === active"
        :class="{ active: i === active }"
        @mousedown.prevent="pick(person)"
        @mousemove="active = i"
      >
        {{ person.name }}
      </li>
      <li v-if="!matches.length" class="none" role="option" aria-disabled="true">No one matches “{{ query }}”</li>
    </ul>
  </div>
</template>

<style scoped>
.person-search {
  position: relative;
  flex: 1 1 160px;
  min-width: 0;
  max-width: 260px;
}

.person-search input {
  width: 100%;
  box-sizing: border-box;
}

.results {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 20;
  max-height: 240px;
  overflow-y: auto;
  margin: 0;
  padding: 4px;
  list-style: none;
  border-radius: 8px;
  border: 1px solid rgba(128, 128, 128, 0.35);
  background: var(--tile-background-color);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}

.results li {
  padding: 7px 10px;
  border-radius: 6px;
  cursor: pointer;
}

.results li.active {
  background: rgba(128, 128, 128, 0.2);
}

.results li.none {
  opacity: 0.7;
  cursor: default;
}
</style>
