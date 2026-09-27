<script setup lang="ts">
// @ts-nocheck
</script>

<template>
    <div class="color-swatch-picker">
        <button type="button" class="color-swatch-current" :class="{ 'color-swatch--white': activeChoice.key === 'white' }"
            :style="{ backgroundColor: activeChoice.hex }" :aria-label="`${labelPrefix}: ${activeChoice.text}. Click to change.`"
            title="Click to choose a different color" @click="isOpen = !isOpen" @blur="onBlur"
            @keydown.esc="isOpen = false"></button>
        <div v-if="isOpen" class="color-swatch-palette">
            <button v-for="(choice, idx) in choices" :key="choice.key" type="button" class="color-swatch-option"
                :class="{ 'color-swatch-option--active': idx === modelValue, 'color-swatch--white': choice.key === 'white' }"
                :style="{ backgroundColor: choice.hex }" :aria-label="choice.text" :title="choice.text"
                @mousedown.prevent="selectChoice(idx)"></button>
        </div>
    </div>
</template>

<script lang="ts">
// Click-to-expand palette (issue #45 follow-up): the current color shows as
// a single swatch button; clicking it reveals the full palette instead of
// always showing every color in a row (issue #32's original design), which
// got crowded once this control was reused per alliance slot.
export default {
    props: {
        choices: {
            type: Array,
            required: true
        },
        modelValue: {
            type: Number,
            required: true
        },
        labelPrefix: {
            type: String,
            default: "Selected color"
        }
    },
    emits: ["update:modelValue"],
    data() {
        return {
            isOpen: false
        };
    },
    computed: {
        activeChoice() {
            return this.choices[this.modelValue] ?? this.choices[0];
        }
    },
    methods: {
        onBlur() {
            // Delayed so a click on a palette option (mousedown, which fires
            // before blur) still registers before the palette closes.
            setTimeout(() => { this.isOpen = false; }, 150);
        },
        selectChoice(idx) {
            this.$emit('update:modelValue', idx);
            this.isOpen = false;
        }
    }
};
</script>

<style scoped>
.color-swatch-picker {
    position: relative;
    display: inline-flex;
}

.color-swatch-current {
    width: 36px;
    height: 36px;
    border-radius: 9px;
    border: 2px solid var(--primary-text-color, #fff);
    padding: 0;
    cursor: pointer;
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.45);
}

.color-swatch-palette {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 20;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    width: 178px;
    margin-top: 6px;
    padding: 8px;
    background: var(--tile-background-color);
    border: 1px solid rgba(128, 128, 128, 0.35);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}

.color-swatch-option {
    width: 36px;
    height: 36px;
    border-radius: 9px;
    border: 2px solid transparent;
    padding: 0;
    cursor: pointer;
}

.color-swatch-option--active {
    border-color: var(--primary-text-color, #fff);
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.45);
}

/* The 'white' choice is a near-invisible swatch against light mode's white
   tile background — shown as black there instead so it's still pickable.
   The choice's real hex (used for actual strokes/labels drawn in that
   color) is untouched; this only affects how the swatch button looks. */
[theme="light"] .color-swatch--white {
    background-color: #000 !important;
}
</style>
