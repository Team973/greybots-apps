<script setup lang="ts">
// @ts-nocheck
import FormSection from '@greybots/common/components/FormSection.vue';

const props = defineProps({
    slotLabel: { default: '' },
    teamNumber: { default: null },
    teamName: { default: '' },
    allianceColor: { default: 'red' },
    schema: { default: () => [] },
    expanded: { default: false },
    dirty: { default: false },
    included: { default: true },
    watched: { default: false },
    formInvalid: { default: false }
});

const emit = defineEmits(['toggle-expand', 'toggle-included', 'form-update']);

function findPostmatchComponent(key) {
    return props.schema?.find((s) => s.key === 'postmatch')?.components?.find((c) => c.key === key);
}
</script>

<template>
    <div class="match-row" :class="{
        'match-row--empty': !dirty,
        'match-row--watched': watched,
        'match-row--invalid': formInvalid,
        'match-row--expanded': expanded
    }">
        <div class="match-row-collapsed" @click="emit('toggle-expand')">
            <span v-if="watched" class="match-row-star" title="On the watchlist">★</span>
            <div class="match-row-slot" :class="`match-row-slot--${allianceColor}`">{{ slotLabel }}</div>
            <div class="match-row-team-info">
                <span class="match-row-team-number">{{ teamNumber ?? '—' }}</span>
                <span class="match-row-team-name">{{ teamName }}</span>
            </div>
            <span v-if="!dirty" class="match-row-empty-badge">No data yet</span>
            <label class="match-row-include-check" @click.stop title="Include this team in submission">
                <input type="checkbox" :checked="included" @change="emit('toggle-included')" />
            </label>
            <div class="match-row-chevron" :class="{ 'match-row-chevron--open': expanded }">›</div>
        </div>

        <transition name="match-row-expand">
            <div v-if="expanded" class="match-row-detail">
                <FormSection section-key="prematch" name="Pre-match"
                    :components="schema.find(s => s.key === 'prematch')?.components ?? []"
                    :color="allianceColor" @form-update="emit('form-update')">
                </FormSection>
                <FormSection section-key="auto" name="Auto"
                    :components="schema.find(s => s.key === 'auto')?.components ?? []"
                    color="gray" @form-update="emit('form-update')">
                </FormSection>
                <FormSection section-key="postmatch" name="Post Match"
                    :components="(schema.find(s => s.key === 'postmatch')?.components ?? []).filter(c => c.key !== 'defense_impact' || findPostmatchComponent('played_defense')?.value)"
                    color="gray" @form-update="emit('form-update')">
                </FormSection>
            </div>
        </transition>
    </div>
</template>

<style scoped>
.match-row {
    background: var(--tile-background-color);
    border-radius: 12px;
    margin-bottom: 8px;
    overflow: hidden;
    box-shadow:
        inset 0 0 0.5px 1px hsla(0, 0%, 100%, 0.07),
        0 1px 4px hsla(230, 13%, 9%, 0.07),
        0 2px 10px hsla(230, 13%, 9%, 0.06);
    transition: box-shadow 0.2s ease, opacity 0.2s ease;
}

.match-row--expanded {
    box-shadow:
        0 0 0 2px #b05703,
        0 4px 20px hsla(230, 13%, 9%, 0.14);
}

/* Grayed out until the scout has actually entered data for this team. */
.match-row--empty {
    opacity: 0.55;
}

.match-row--empty .match-row-team-number,
.match-row--empty .match-row-team-name {
    filter: grayscale(60%);
}

/* Watched teams get a yellow border + star, even while grayed out. */
.match-row--watched {
    box-shadow:
        0 0 0 2px #e0b400,
        0 2px 10px hsla(230, 13%, 9%, 0.06);
}

.match-row--watched.match-row--expanded {
    box-shadow:
        0 0 0 2px #e0b400,
        0 4px 20px hsla(230, 13%, 9%, 0.14);
}

.match-row--invalid {
    box-shadow: 0 0 0 2px red;
}

.match-row-collapsed {
    display: flex;
    align-items: center;
    padding: 10px 14px;
    cursor: pointer;
    gap: 10px;
    min-height: 56px;
    user-select: none;
}

.match-row-star {
    color: #e0b400;
    font-size: 18px;
    flex-shrink: 0;
    line-height: 1;
}

.match-row-slot {
    font-size: 12px;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 6px;
    flex-shrink: 0;
    white-space: nowrap;
}

.match-row-slot--red {
    background: rgba(255, 0, 0, 0.15);
    color: #d32f2f;
}

.match-row-slot--blue {
    background: rgba(0, 0, 255, 0.15);
    color: #1a5fd3;
}

.match-row-team-info {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
}

.match-row-team-number {
    font-size: 16px;
    font-weight: 700;
    color: var(--primary-text-color);
    line-height: 1.2;
}

.match-row-team-name {
    font-size: 12px;
    color: rgba(128, 128, 128, 0.8);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.match-row-empty-badge {
    font-size: 11px;
    color: rgba(128, 128, 128, 0.7);
    font-style: italic;
    flex-shrink: 0;
    white-space: nowrap;
}

.match-row-include-check {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    cursor: pointer;
}

.match-row-include-check input[type="checkbox"] {
    width: 18px;
    height: 18px;
    accent-color: #b05703;
    cursor: pointer;
}

.match-row-chevron {
    font-size: 22px;
    font-weight: 300;
    color: rgba(128, 128, 128, 0.5);
    transition: transform 0.22s ease, color 0.15s ease;
    flex-shrink: 0;
    line-height: 1;
}

.match-row-chevron--open {
    transform: rotate(90deg);
    color: #b05703;
}

.match-row-detail {
    border-top: 1px solid rgba(128, 128, 128, 0.15);
    padding: 6px 10px 14px;
    overflow: hidden;
}

.match-row-expand-enter-active,
.match-row-expand-leave-active {
    transition: max-height 0.28s ease, opacity 0.22s ease;
    max-height: 1200px;
    overflow: hidden;
}

.match-row-expand-enter-from,
.match-row-expand-leave-to {
    max-height: 0;
    opacity: 0;
}
</style>
