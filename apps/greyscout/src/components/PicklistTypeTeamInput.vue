<script setup lang="ts">
// @ts-nocheck
// A box for typing a team number into a pick list tier, the ranked team
// list, or Unranked — the pick list's half of the "Type team numbers" entry
// preference (see lib/preferences.ts; the Playoffs page has the other half).
// Enter (or tapping away, since a phone keyboard doesn't always send Enter)
// hands what was typed to `enter`, which moves the team and returns an error
// to show, or null. The box keeps focus after a team goes in, so a run of
// teams can be typed one after another.
import { ref } from 'vue';

const props = defineProps<{
    inputId: string;
    placeholder: string;
    label: string;
    enter: (raw: string) => string | null;
}>();

const value = ref('');
const error = ref('');

function submit() {
    const raw = value.value.trim();
    if (!raw) return;
    error.value = props.enter(raw) ?? '';
    // A team that can't go in is cleared too, so the box never looks like
    // it holds a team that isn't on the list.
    value.value = '';
}
</script>

<template>
    <div class="picklist-type-team">
        <input :id="inputId" v-model="value" type="text" inputmode="numeric" enterkeyhint="done"
            class="picklist-type-team-input" :placeholder="placeholder" autocomplete="off" :aria-label="label"
            @input="error = ''" @keydown.enter.prevent="submit" @blur="submit" />
        <p v-if="error" class="picklist-type-team-error" role="alert">{{ error }}</p>
    </div>
</template>

<style scoped>
.picklist-type-team {
    padding: 6px 0 2px;
}

.picklist-type-team-input {
    width: 100%;
    min-height: 44px;
    box-sizing: border-box;
    padding: 0 12px;
    border: 1.5px dashed rgba(128, 128, 128, 0.4);
    border-radius: 8px;
    background: transparent;
    color: var(--primary-text-color);
    font: inherit;
    font-size: 16px;
    font-weight: 700;
    cursor: text;
}

.picklist-type-team-input::placeholder {
    font-size: 13px;
    font-weight: 400;
    color: rgba(128, 128, 128, 0.75);
}

.picklist-type-team-input:hover {
    border-color: rgba(176, 87, 3, 0.6);
}

.picklist-type-team-input:focus {
    outline: none;
    border-style: solid;
    border-color: #b05703;
}

.picklist-type-team-error {
    margin: 4px 2px 0;
    font-size: 12px;
    color: #d32f2f;
}
</style>
