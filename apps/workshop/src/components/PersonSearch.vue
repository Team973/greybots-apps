<script lang="ts">
// Ids for the list and its options, unique per box on the page.
let count = 0;
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type CSSProperties } from 'vue';
import { useDirectoryStore, type Person } from '@/stores/directory-store';

// Type to find someone with a Workshop role, then Enter (or click) to pick
// them: a combobox, so the arrow keys move through the matches. Escape closes
// the list first (and only then reaches whatever's around it).
// `membersOnly` leaves out observers (for checklists, which they can't work
// on); `autofocus` puts the cursor in the box (and opens the list) as soon as
// it appears, for a box shown by clicking something else.
const props = withDefaults(defineProps<{ exclude?: string[]; placeholder?: string; label: string; membersOnly?: boolean; autofocus?: boolean }>(), {
  exclude: () => [],
  placeholder: 'Type a name…',
  membersOnly: false,
  autofocus: false
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
  const people = (props.membersOnly ? directory.members : directory.assignable).filter((p) => !props.exclude.includes(p.user_id));
  if (!q) return people;
  const starts = people.filter((p) => p.name.toLowerCase().startsWith(q) || p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)));
  const contains = people.filter((p) => !starts.includes(p) && p.name.toLowerCase().includes(q));
  return [...starts, ...contains];
});

// The list is fixed to the screen, next to the box, so it hangs over the
// edge of whatever it's in (a dialog, a panel) rather than making that scroll.
// It opens upward when there isn't room below.
const input = ref<HTMLInputElement | null>(null);
const listStyle = ref<CSSProperties>({});
const LIST_MAX = 240;
function place() {
  const box = input.value?.getBoundingClientRect();
  if (!box) return;
  const below = window.innerHeight - box.bottom - 8;
  const above = box.top - 8;
  const up = below < Math.min(LIST_MAX, 160) && above > below;
  listStyle.value = {
    left: `${box.left}px`,
    width: `${box.width}px`,
    maxHeight: `${Math.max(80, Math.min(LIST_MAX, up ? above : below))}px`,
    ...(up ? { bottom: `${window.innerHeight - box.top + 4}px` } : { top: `${box.bottom + 4}px` })
  };
}
// Keep it next to the box while anything scrolls or the window resizes.
function follow(on: boolean) {
  const method = on ? 'addEventListener' : 'removeEventListener';
  window[method]('scroll', place, true);
  window[method]('resize', place);
}
watch(open, (isOpen) => {
  follow(isOpen);
  if (isOpen) place();
});
onBeforeUnmount(() => follow(false));
onMounted(() => {
  if (props.autofocus) input.value?.focus();
});

function show() {
  open.value = true;
  active.value = 0;
  place();
}
function pick(person: Person | undefined) {
  if (!person) return;
  emit('pick', person.user_id);
  query.value = '';
  active.value = 0;
  // The box may have moved (a picked name's chip goes in front of it).
  nextTick(place);
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
      ref="input"
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
    <ul v-if="open" :id="`${id}-list`" class="results" role="listbox" :aria-label="label" :style="listStyle">
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
  position: fixed;
  z-index: 1000;
  box-sizing: border-box;
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
