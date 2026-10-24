<script setup lang="ts">
import { ref } from 'vue';
import { errorMessage } from '@/lib/db';
import { recognitionLevels } from '@/lib/points';
import { bountyOptions } from '@/lib/tickets';
import { useDirectoryStore, type Component } from '@/stores/directory-store';

// Setup for leads and admins: the components (parts of the team) tickets are
// tagged with. A component that's no longer used is archived rather than
// deleted, so old tickets keep their labels. Also lists the fixed GreyPoints
// values, for reference.
const directory = useDirectoryStore();

const name = ref('');
const color = ref('#3987e5');
const error = ref('');
const busy = ref(false);

async function act(action: () => Promise<unknown>) {
  error.value = '';
  busy.value = true;
  try {
    await action();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

function add() {
  if (!name.value.trim()) return;
  return act(async () => {
    await directory.addComponent(name.value, color.value);
    name.value = '';
  });
}

function rename(component: Component, event: Event) {
  const value = (event.target as HTMLInputElement).value.trim();
  if (!value || value === component.name) return;
  return act(() => directory.updateComponent(component.id, { name: value }));
}

function move(index: number, by: number) {
  const list = [...directory.components];
  const [moved] = list.splice(index, 1);
  list.splice(index + by, 0, moved);
  return act(() => Promise.all(list.map((c, i) => (c.sort_order === i + 1 ? null : directory.updateComponent(c.id, { sort_order: i + 1 })))));
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1>Setup</h1>
    </header>
    <p v-if="error" class="error-text">{{ error }}</p>

    <section class="panel">
      <h2>Components</h2>
      <p class="hint">The parts of the team a ticket can touch (Mechanical, Electrical, Programming…). Tickets can have several.</p>
      <ul class="components">
        <li v-for="(component, index) in directory.components" :key="component.id" :class="{ archived: component.archived }">
          <input
            type="color"
            :value="component.color || '#888888'"
            :aria-label="`${component.name} color`"
            :disabled="busy"
            @change="act(() => directory.updateComponent(component.id, { color: ($event.target as HTMLInputElement).value }))"
          />
          <input class="control name" type="text" :value="component.name" :aria-label="`Rename ${component.name}`" :disabled="busy" @change="rename(component, $event)" />
          <button class="icon-small" :disabled="busy || index === 0" aria-label="Move up" @click="move(index, -1)">↑</button>
          <button class="icon-small" :disabled="busy || index === directory.components.length - 1" aria-label="Move down" @click="move(index, 1)">↓</button>
          <button class="button small" :disabled="busy" @click="act(() => directory.updateComponent(component.id, { archived: !component.archived }))">
            {{ component.archived ? 'Restore' : 'Archive' }}
          </button>
        </li>
        <li v-if="!directory.components.length" class="empty">No components yet.</li>
      </ul>
      <form class="add" @submit.prevent="add">
        <input v-model="color" type="color" aria-label="New component color" />
        <input v-model="name" class="control name" type="text" maxlength="60" placeholder="New component" aria-label="New component name" />
        <button type="submit" class="button primary" :disabled="busy || !name.trim()">Add</button>
      </form>
    </section>

    <section class="panel">
      <h2>GreyPoints values</h2>
      <p class="hint">Fixed, so the system can't be gamed. Bounties are set by a lead or admin who isn't the ticket's owner or an assignee.</p>
      <div class="values">
        <div>
          <h3>Ticket bounties</h3>
          <ul>
            <li v-for="b in bountyOptions" :key="b.points">{{ b.label }}: <strong>{{ b.points }}</strong></li>
          </ul>
        </div>
        <div>
          <h3>Team recognitions</h3>
          <ul>
            <li v-for="l in recognitionLevels" :key="l.key">{{ l.label }}: <strong>{{ l.points }}</strong></li>
          </ul>
        </div>
      </div>
      <p class="hint">
        A completed ticket's bounty is split equally between its assignees. An owner who isn't an assignee takes 10% off the top; with no
        assignees, the owner gets it all.
      </p>
    </section>
  </div>
</template>

<style scoped>
.components {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.components li,
.add {
  display: flex;
  align-items: center;
  gap: 8px;
}

.components li.archived .name {
  opacity: 0.5;
  text-decoration: line-through;
}

.name {
  flex: 1;
}

input[type='color'] {
  width: 36px;
  height: 32px;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
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

.values {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 40px;
}

.values h3 {
  margin: 0 0 4px;
  font-size: 0.95rem;
}

.values ul {
  margin: 0;
  padding-left: 18px;
}
</style>
