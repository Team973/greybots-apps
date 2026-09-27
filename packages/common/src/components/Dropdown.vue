<script setup lang="ts">
// TODO: fix types
// @ts-nocheck
</script>

<template>
    <div class="dropdown-select" :class="{ 'dropdown-select--error': error }">
        <input type="text" class="dropdown-select-input" :style="{ minWidth: minWidthCh }" :placeholder="placeholder"
            :value="displayValue" :required="required" @input="onInput" @focus="onFocus" @blur="onBlur"
            @keydown="onKeydown" />
        <ul v-if="isOpen" class="dropdown-select-list">
            <li v-if="filteredChoices.length === 0" class="dropdown-select-empty">No matches</li>
            <li v-for="entry in filteredChoices" :key="entry.idx" class="dropdown-select-option"
                :class="{ 'dropdown-select-option--active': entry.idx === modelValue }"
                @mousedown.prevent="selectChoice(entry.idx)">
                {{ entry.text }}
            </li>
        </ul>
    </div>
</template>

<script lang="ts">
export default {
    props: {
        choices: { default: () => [] },
        // Index into choices — kept index-based (rather than SearchableDropdown's
        // key-based binding) since callers throughout the app, including
        // parseScoutData() for scouting-form submissions, already treat this
        // modelValue as a position in the choices array.
        modelValue: { required: true },
        error: { default: false },
        required: { default: false },
        placeholder: { default: 'Search…' }
    },
    emits: ['update:modelValue'],
    data() {
        return {
            // null = not actively editing; the input shows the current
            // selection's text. Once the user types, this holds their
            // literal query until blur/select/Escape resets it to null.
            query: null,
            isOpen: false
        };
    },
    computed: {
        activeChoice() {
            // Out-of-bounds modelValue falls back to an empty choice so callers
            // can't crash the input while a valid selection is pending.
            return this.choices[this.modelValue] ?? null;
        },
        displayValue() {
            return this.query !== null ? this.query : (this.activeChoice?.text ?? '');
        },
        filteredChoices() {
            const indexed = this.choices.map((choice, idx) => ({ ...choice, idx }));
            const q = (this.query ?? '').trim().toLowerCase();
            if (!q) return indexed;
            return indexed.filter((c) => c.text.toLowerCase().includes(q));
        },
        // Sized to the widest possible choice (not just the current value) so
        // the box never visually clips a selection's text — a plain <input>
        // otherwise defaults to a fixed browser width regardless of its
        // value's length — and so it doesn't reflow narrower/wider as the
        // user picks between differently-sized choices.
        minWidthCh() {
            const longest = this.choices.reduce((max, c) => Math.max(max, (c.text ?? '').length), this.placeholder.length);
            return `${Math.max(longest + 2, 10)}ch`;
        }
    },
    methods: {
        onInput(event) {
            this.query = event.target.value;
            this.isOpen = true;
        },
        onFocus() {
            this.query = '';
            this.isOpen = true;
        },
        onBlur() {
            // Delayed so a click on an option (mousedown, which fires before
            // blur) still registers before the list closes.
            setTimeout(() => {
                this.query = null;
                this.isOpen = false;
            }, 150);
        },
        onKeydown(event) {
            if (event.key === 'Escape') {
                this.query = null;
                this.isOpen = false;
                event.target.blur();
            } else if (event.key === 'Enter') {
                event.preventDefault();
                const first = this.filteredChoices[0];
                if (first) this.selectChoice(first.idx);
            }
        },
        selectChoice(idx) {
            this.$emit('update:modelValue', idx);
            this.query = null;
            this.isOpen = false;
        }
    }
}
</script>

<style scoped>
.dropdown-select {
    position: relative;
}

.dropdown-select-input {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    font-size: 1rem;
    font-family: inherit;
    border-radius: 6px;
    border: 1px solid rgba(128, 128, 128, 0.35);
    background-color: transparent;
    color: var(--primary-text-color);
}

.dropdown-select-input:hover {
    border-color: rgba(128, 128, 128, 0.6);
}

.dropdown-select-input:focus {
    outline: none;
    border-color: #b05703;
}

.dropdown-select--error .dropdown-select-input {
    border-color: #c0392b;
}

.dropdown-select-list {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 20;
    max-height: 260px;
    overflow-y: auto;
    margin: 4px 0 0;
    padding: 4px 0;
    list-style: none;
    background: var(--tile-background-color);
    color: var(--primary-text-color);
    border: 1px solid rgba(128, 128, 128, 0.35);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}

.dropdown-select-option {
    padding: 8px 14px;
    cursor: pointer;
    font-size: 14px;
}

.dropdown-select-option:hover,
.dropdown-select-option--active {
    background: rgba(176, 87, 3, 0.15);
}

.dropdown-select-empty {
    padding: 8px 14px;
    color: rgba(128, 128, 128, 0.7);
    font-size: 14px;
}
</style>
