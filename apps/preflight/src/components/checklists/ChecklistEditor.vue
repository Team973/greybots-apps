<script setup lang="ts">
import {
  matchLinkLabels,
  newStep,
  stepConditionLabels,
  stepInputLabels,
  stepInputs,
  type ChecklistDef,
  type MatchLink,
  type PitRole,
  type StepCondition
} from '@/lib/checklists/config';

// Edits one checklist in place (Pit setup): its name, steps, each step's
// instructions, roles, what it records, and when it applies. The parent owns
// saving, and the list the checklist sits in.
const props = defineProps<{
  checklist: ChecklistDef;
  index: number;
  count: number;
  roles: PitRole[];
  canEdit: boolean;
  // Part of the pit sequence (numbered, can be the pre-match checklist).
  inSequence?: boolean;
  // What "Belongs to" means when it's left on automatic.
  autoLinkLabel: string;
}>();
const emit = defineEmits<{ move: [delta: number]; remove: []; prematch: [on: boolean] }>();

const conditions = Object.entries(stepConditionLabels) as [StepCondition, string][];
const links = Object.entries(matchLinkLabels) as [MatchLink, string][];

function move<T>(list: T[], index: number, delta: number) {
  const target = index + delta;
  if (target < 0 || target >= list.length) return;
  const [item] = list.splice(index, 1);
  list.splice(target, 0, item);
}

function toggleRole(stepIndex: number, roleId: string) {
  const step = props.checklist.steps[stepIndex];
  step.role_ids = step.role_ids.includes(roleId) ? step.role_ids.filter((id) => id !== roleId) : [...step.role_ids, roleId];
}

function setLink(value: string) {
  // "" = automatic: leave the field off so the default rule applies.
  if (value) props.checklist.match_link = value as MatchLink;
  else delete props.checklist.match_link;
}
</script>

<template>
  <article class="checklist">
    <div class="checklist-head">
      <span v-if="inSequence" class="badge">{{ index + 1 }}</span>
      <input v-model="checklist.name" class="checklist-name" :readonly="!canEdit" placeholder="Checklist name" aria-label="Checklist name" />
      <template v-if="canEdit">
        <button class="icon-small" :disabled="index === 0" aria-label="Move checklist up" @click="emit('move', -1)">↑</button>
        <button class="icon-small" :disabled="index === count - 1" aria-label="Move checklist down" @click="emit('move', 1)">↓</button>
        <button class="icon-small" aria-label="Delete checklist" @click="emit('remove')">✕</button>
      </template>
    </div>
    <div class="checklist-options">
      <label v-if="inSequence" class="prematch-flag" title="After repairs, the pit can jump straight to this checklist">
        <input type="checkbox" :checked="!!checklist.prematch" :disabled="!canEdit" @change="emit('prematch', ($event.target as HTMLInputElement).checked)" />
        Pre-match checklist (repairs can jump here)
      </label>
      <label class="inline-select">
        <span>Belongs to</span>
        <select :value="checklist.match_link ?? ''" :disabled="!canEdit" @change="setLink(($event.target as HTMLSelectElement).value)">
          <option value="">{{ autoLinkLabel }}</option>
          <option v-for="[value, label] in links" :key="value" :value="value">{{ label }}</option>
        </select>
      </label>
    </div>

    <ol class="steps">
      <li v-for="(step, si) in checklist.steps" :key="step.id" class="step">
        <div class="step-head">
          <span class="step-num">{{ si + 1 }}.</span>
          <input v-model="step.title" class="step-title" :readonly="!canEdit" placeholder="Step" aria-label="Step title" />
          <template v-if="canEdit">
            <button class="icon-small" :disabled="si === 0" aria-label="Move step up" @click="move(checklist.steps, si, -1)">↑</button>
            <button class="icon-small" :disabled="si === checklist.steps.length - 1" aria-label="Move step down" @click="move(checklist.steps, si, 1)">↓</button>
            <button class="icon-small" aria-label="Delete step" @click="checklist.steps.splice(si, 1)">✕</button>
          </template>
        </div>
        <textarea v-model="step.instructions" rows="2" :readonly="!canEdit" placeholder="Instructions" aria-label="Instructions"></textarea>
        <div class="step-options">
          <label class="inline-select">
            <span>Records</span>
            <select :value="step.input ?? 'check'" :disabled="!canEdit" @change="step.input = ($event.target as HTMLSelectElement).value as typeof step.input">
              <option v-for="input in stepInputs" :key="input" :value="input">{{ stepInputLabels[input] }}</option>
            </select>
          </label>
          <label class="inline-select">
            <span>When</span>
            <select v-model="step.condition" :disabled="!canEdit">
              <option :value="null">Always</option>
              <option v-for="[value, label] in conditions" :key="value" :value="value">{{ label }}</option>
            </select>
          </label>
        </div>
        <div v-if="roles.length" class="role-chips" role="group" aria-label="Roles for this step">
          <button
            v-for="role in roles"
            :key="role.id"
            type="button"
            class="chip"
            :class="{ on: step.role_ids.includes(role.id) }"
            :aria-pressed="step.role_ids.includes(role.id)"
            :disabled="!canEdit"
            @click="toggleRole(si, role.id)"
          >
            {{ role.name || 'Unnamed role' }}
          </button>
        </div>
      </li>
    </ol>
    <button v-if="canEdit" class="add-link" @click="checklist.steps.push(newStep())">+ Add step</button>
  </article>
</template>

<style scoped>
.checklist {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--accent-color);
  background: var(--background-color);
}

.checklist-head,
.step-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: #ffc107;
  color: #1a1a1a;
  font-weight: 700;
}

input.checklist-name,
input.step-title,
.step textarea {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--accent-color);
  background: var(--tile-background-color);
  color: var(--primary-text-color);
  font: inherit;
  box-sizing: border-box;
}

input.checklist-name {
  font-size: 1.05rem;
  font-weight: 600;
}

.checklist-options,
.step-options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 16px;
}

.steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.step {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-left: 8px;
  border-left: 2px solid var(--accent-color);
}

.step-num {
  min-width: 20px;
  opacity: 0.7;
}

.step textarea {
  width: 100%;
  resize: vertical;
  font-size: 0.9rem;
}

.prematch-flag {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  opacity: 0.85;
}

.inline-select {
  flex: 1 1 220px;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 0.8rem;
}

.inline-select span {
  flex: none;
  opacity: 0.7;
}

.inline-select select {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  border-radius: 6px;
  border: 1px solid var(--accent-color);
  background: var(--tile-background-color);
  color: var(--primary-text-color);
  font: inherit;
}

.role-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.chip {
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid var(--accent-color);
  background: transparent;
  color: var(--primary-text-color);
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
  opacity: 0.7;
}

.chip.on {
  border-color: #2e7d32;
  background: #2e7d32;
  color: #fff;
  opacity: 1;
}

.chip:disabled {
  cursor: default;
}

.add-link {
  align-self: flex-start;
  padding: 0;
  border: none;
  background: none;
  color: var(--header-hover-color);
  font: inherit;
  cursor: pointer;
}
</style>
