<script setup lang="ts">
// @ts-nocheck
</script>

<template>
    <div class="fullscreen-tile" ref="tileEl">
        <button type="button" class="fullscreen-toggle" @click="toggleFullscreen"
            :aria-label="isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'">{{ isFullscreen ? "⤢" : "⛶" }}</button>
        <slot></slot>
    </div>
</template>

<script lang="ts">
// Generic fullscreen wrapper for an entire tile/card (issue #32 feedback:
// fullscreen should cover the whole tile — all its dropdowns/toggles/
// buttons — not just an inner canvas). AutoPathCanvas itself no longer
// owns any fullscreen behavior; each place that wants a fullscreen toggle
// (AutoPathEditor, AutoPathCard, StrategyView's Preview/Auto Edit tile)
// wraps its whole tile content in this component instead.
export default {
    data() {
        return {
            isFullscreen: false
        };
    },
    mounted() {
        document.addEventListener("fullscreenchange", this.onFullscreenChange);
    },
    beforeUnmount() {
        document.removeEventListener("fullscreenchange", this.onFullscreenChange);
    },
    methods: {
        toggleFullscreen() {
            if (!document.fullscreenElement) {
                this.$refs.tileEl.requestFullscreen?.();
            } else {
                document.exitFullscreen?.();
            }
        },
        onFullscreenChange() {
            this.isFullscreen = document.fullscreenElement === this.$refs.tileEl;
        }
    }
};
</script>

<style scoped>
.fullscreen-tile {
    position: relative;
}

.fullscreen-tile:fullscreen {
    width: 100vw;
    height: 100vh;
    overflow-y: auto;
    background: var(--tile-background-color, #1b1b1b);
    padding: 20px;
    box-sizing: border-box;
}

.fullscreen-toggle {
    position: absolute;
    top: 6px;
    right: 6px;
    z-index: 5;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
}

.fullscreen-toggle:hover {
    background: rgba(0, 0, 0, 0.75);
}
</style>
