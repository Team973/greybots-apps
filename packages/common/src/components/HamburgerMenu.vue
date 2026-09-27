<script setup lang="ts">

import { Transition } from 'vue';

import '@material/web/icon/icon';

</script>

<template>
    <div class="hamburger-container" ref="container">
        <div class="menu-title">
            <slot name="menu-title"></slot>
        </div>
        <div class="hamburger-button-container">
            <a class="hamburger-button" v-if="enabled" @click="expanded = !expanded">
                <md-icon slot="icon" v-if="expanded">close </md-icon>
                <md-icon slot="icon" v-if="!expanded">menu</md-icon>
            </a>
        </div>

        <slot name="theme-button"></slot>
        <Transition name="slide">
            <div class="hamburger-menu-container" v-if="expanded" @click="expanded = false">
                <slot name="menu-content"></slot>
            </div>
        </Transition>
    </div>
</template>

<script lang="ts">
export default {
    props: {
        enabled: {
            default: true,
            type: Boolean
        }
    },
    data() {
        return {
            expanded: false
        }
    },
    watch: {
        // Clicking anywhere outside the menu (button or dropdown) closes it,
        // same as clicking a link inside it does.
        expanded(isExpanded) {
            if (isExpanded) {
                document.addEventListener('click', this.handleOutsideClick, true);
            } else {
                document.removeEventListener('click', this.handleOutsideClick, true);
            }
        }
    },
    beforeUnmount() {
        document.removeEventListener('click', this.handleOutsideClick, true);
    },
    methods: {
        handleOutsideClick(event: MouseEvent) {
            const container = this.$refs.container as HTMLElement | undefined;
            if (container && !container.contains(event.target as Node)) {
                this.expanded = false;
            }
        }
    }
}
</script>

<style scoped>
.hamburger-container {
    display: block;
    min-height: 65px;
    width: 100%;
    position: relative;
}

.hamburger-button-container {
    /* Height and width chosen to match title bar height and be a square */
    height: 65px;
    width: 65px;
    position: relative;
    float: right;
    /* display: inline-block; */
}

.hamburger-button {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #FFF;
    height: 100%;
    width: 100%;
}

.hamburger-button:hover {
    background-color: var(--bbq-header-hover-color);
    cursor: pointer;
}

.hamburger-menu-container {
    transition: background-color .5s ease;
    background-color: var(--bbq-header-color);
    display: block;
    height: auto;
    /* iOS Safari otherwise inflates text in wide blocks. */
    -webkit-text-size-adjust: 100%;
    text-size-adjust: 100%;
    /* A right-anchored dropdown panel, not a full-width strip — narrow
       enough to read as a menu rather than covering the whole page,
       capped to the viewport on small screens. */
    position: absolute;
    top: 65px;
    right: 0;
    width: min(320px, 100vw);
    box-shadow: -2px 4px 12px hsla(230, 13%, 9%, 0.25);
    /* Now that every nav link lives in here (mobile or not), the list can
       be taller than the viewport — cap it below the 65px title bar and
       let it scroll internally instead of pushing links off-screen with
       no way to reach them. */
    max-height: calc(100vh - 65px);
    /* On iOS Safari 100vh includes the area behind the browser toolbars, so
       prefer the dynamic viewport height where supported. */
    max-height: calc(100dvh - 65px);
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
}

/* Transition styling */
.slide-enter-active,
.slide-leave-active {
    transition: all 0.3s ease-out;
}

.slide-enter-from,
.slide-leave-to {
    opacity: 0;
}

.menu-title {
    position: absolute;
    display: flex;
    align-items: center;
    color: #FFF;
    padding: 20px;
}
</style>
