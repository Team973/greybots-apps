<script setup lang="ts">
// @ts-nocheck
</script>

<template>
    <div class="collapsible-section">
        <button type="button" class="collapsible-header" @click="toggle" :aria-expanded="open">
            <span class="collapsible-chevron" :class="{ 'collapsible-chevron--closed': !open }">▾</span>
            <span class="collapsible-title">{{ title }}</span>
        </button>
        <div class="collapsible-body" v-show="open">
            <slot></slot>
        </div>
    </div>
</template>

<script lang="ts">
export default {
    props: {
        title: {
            type: String,
            default: ""
        },
        defaultOpen: {
            type: Boolean,
            default: true
        }
    },
    data() {
        return {
            open: this.defaultOpen
        }
    },
    methods: {
        toggle() {
            this.open = !this.open;
        }
    }
}
</script>

<style scoped>
.collapsible-section {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    background-color: var(--tile-background-color);
    border-radius: 10px;
    margin: 15px;
    overflow: hidden;

    box-shadow: inset 0 0 0.5px 1px hsla(0, 0%, 100%, 0.1),
        0 0 0 1px hsla(230, 13%, 9%, 0.075),
        0 0.3px 0.4px hsla(230, 13%, 9%, 0.02),
        0 0.9px 1.5px hsla(230, 13%, 9%, 0.045),
        0 3.5px 6px hsla(230, 13%, 9%, 0.09);
}

.collapsible-header {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 16px 20px;
    background: none;
    border: none;
    cursor: pointer;
    font: inherit;
    color: var(--primary-text-color);
    text-align: left;
}

.collapsible-header:hover {
    background-color: rgba(128, 128, 128, 0.08);
}

.collapsible-title {
    font-size: 1.4em;
}

.collapsible-chevron {
    display: inline-block;
    transition: transform 0.15s ease;
    flex-shrink: 0;
}

.collapsible-chevron--closed {
    transform: rotate(-90deg);
}

.collapsible-body {
    padding: 0 20px 20px;
}
</style>
