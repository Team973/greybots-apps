<script setup lang="ts">
// A divider between groups on the team pick list (see team-list-layout.ts).
// Uses the same `.picklist-drag-handle` class as PicklistRow, so one
// draggable `handle` covers both. Keep the template's root a single element
// with nothing before it: a leading comment makes a fragment root, which
// breaks vuedraggable (see PicklistUnrankedCard.vue).
const props = defineProps<{
    label: string;
    editable: boolean;
}>();

const emit = defineEmits<{
    'update:label': [label: string];
    remove: [];
}>();

function onLabelChange(event: Event) {
    const label = (event.target as HTMLInputElement).value.trim();
    if (label !== props.label) emit('update:label', label);
}
</script>

<template>
    <div class="picklist-divider" :class="{ 'picklist-divider--editable': editable }">
        <div v-if="editable" class="picklist-drag-handle" title="Drag to move this divider">
            <span class="drag-dots">⠿</span>
        </div>
        <span class="picklist-divider-line"></span>
        <input v-if="editable" class="picklist-divider-label" type="text" :value="label" maxlength="60"
            placeholder="Label (optional)" aria-label="Divider label" @change="onLabelChange"
            @keydown.enter="($event.target as HTMLInputElement).blur()" />
        <span v-else-if="label" class="picklist-divider-label picklist-divider-label--static">{{ label }}</span>
        <span class="picklist-divider-line"></span>
        <button v-if="editable" type="button" class="picklist-divider-remove" title="Remove this divider"
            aria-label="Remove this divider" @click="emit('remove')">✕</button>
    </div>
</template>

<style scoped>
.picklist-divider {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    margin: 4px 0 12px;
    padding: 0 4px;
}

.picklist-drag-handle {
    color: rgba(128, 128, 128, 0.5);
    cursor: grab;
    font-size: 20px;
    padding: 4px;
    flex-shrink: 0;
    line-height: 1;
    transition: color 0.15s;
}

.picklist-drag-handle:hover {
    color: #b05703;
}

.picklist-divider-line {
    flex: 1;
    min-width: 16px;
    border-top: 2px solid #b05703;
    opacity: 0.7;
}

.picklist-divider-label {
    flex: 0 1 220px;
    min-width: 0;
    font: inherit;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    text-align: center;
    color: #b05703;
}

input.picklist-divider-label {
    padding: 6px 8px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
}

input.picklist-divider-label:hover,
input.picklist-divider-label:focus {
    border-color: rgba(176, 87, 3, 0.5);
    background: var(--tile-background-color);
    outline: none;
}

input.picklist-divider-label::placeholder {
    color: rgba(128, 128, 128, 0.7);
    font-weight: 500;
    text-transform: none;
    letter-spacing: normal;
}

.picklist-divider-label--static {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.picklist-divider-remove {
    flex-shrink: 0;
    min-width: 36px;
    min-height: 36px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: rgba(128, 128, 128, 0.9);
    font: inherit;
    cursor: pointer;
}

.picklist-divider-remove:hover {
    background: rgba(211, 47, 47, 0.14);
    color: #d32f2f;
}
</style>
