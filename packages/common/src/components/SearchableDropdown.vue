<script setup lang="ts">
// TODO: fix types
// @ts-nocheck
</script>

<template>
    <div class="searchable-dropdown">
        <input type="text" class="searchable-dropdown-input" :style="{ minWidth: minWidthCh }" :placeholder="placeholder"
            :value="displayValue" @input="onInput" @focus="onFocus" @blur="onBlur" @keydown="onKeydown" />
        <ul v-if="isOpen" class="searchable-dropdown-list">
            <li v-if="filteredChoices.length === 0" class="searchable-dropdown-empty">No matches</li>
            <li v-for="choice in filteredChoices" :key="choice.key" class="searchable-dropdown-option"
                :class="{ 'searchable-dropdown-option--active': choice.key === modelValue }"
                @mousedown.prevent="selectChoice(choice)">
                {{ choice.text }}
            </li>
        </ul>
    </div>
</template>

<script lang="ts">
export default {
    props: {
        // {key, text}[] — same shape as Dropdown.vue's choices, but
        // modelValue here binds directly to a choice's key (not its index),
        // since an index can't survive a live-filtered list.
        choices: { default: () => [] },
        modelValue: { required: true },
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
            return this.choices.find((c) => c.key === this.modelValue) ?? null;
        },
        displayValue() {
            return this.query !== null ? this.query : (this.activeChoice?.text ?? '');
        },
        filteredChoices() {
            const q = (this.query ?? '').trim().toLowerCase();
            if (!q) return this.choices;
            return this.choices.filter((c) => c.text.toLowerCase().includes(q));
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
                if (first) this.selectChoice(first);
            }
        },
        selectChoice(choice) {
            this.$emit('update:modelValue', choice.key);
            this.query = null;
            this.isOpen = false;
        }
    }
}
</script>

<style scoped>
.searchable-dropdown {
    position: relative;
}

.searchable-dropdown-input {
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

.searchable-dropdown-input:hover {
    border-color: rgba(128, 128, 128, 0.6);
}

.searchable-dropdown-input:focus {
    outline: none;
    border-color: #b05703;
}

.searchable-dropdown-list {
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

.searchable-dropdown-option {
    padding: 8px 14px;
    cursor: pointer;
    font-size: 14px;
}

.searchable-dropdown-option:hover,
.searchable-dropdown-option--active {
    background: rgba(176, 87, 3, 0.15);
}

.searchable-dropdown-empty {
    padding: 8px 14px;
    color: rgba(128, 128, 128, 0.7);
    font-size: 14px;
}
</style>
