<script setup lang="ts">
// TODO: fix types
// @ts-nocheck

import { RouterLink } from 'vue-router';

import HamburgerMenu from '@greybots/common/components/HamburgerMenu.vue';

import { useViewModeStore } from '@greybots/common/stores/view-mode-store';
import { useEventStore } from '@/stores/event-store';
import { useAuthStore } from "@/stores/auth-store";
import { useOfflineQueueStore } from "@/stores/offline-queue-store";
</script>

<template>
    <!-- Nav bar is always a hamburger menu, mobile or not — the links live
         entirely inside the menu-content slot regardless of viewport width. -->
    <div class="nav" :class="{ 'nav--hidden': navHidden }" v-if="isLoggedIn">
        <HamburgerMenu>
            <template v-slot:menu-title>
                {{ eventName }}
            </template>
            <template v-slot:theme-button>
                <RouterLink to="/account" class="nav-dark-mode nav-mobile-right" title="Account">
                    <md-icon slot="icon">account_circle</md-icon>
                    <div class="nav-online-dot"
                        :class="isOnline ? 'nav-online-dot--online' : 'nav-online-dot--offline'"
                        :title="isOnline ? 'Online' : 'Offline'"></div>
                </RouterLink>
                <div class="nav-dark-mode nav-mobile-right" @click="toggleUserDarkMode">
                    <md-icon slot="icon" v-if="isDarkMode">dark_mode</md-icon>
                    <md-icon slot="icon" v-else>light_mode</md-icon>
                </div>
            </template>
            <template v-slot:menu-content>
                <!-- <RouterLink to="/upload" class="nav-link nav-link-mobile" v-if="isWriteAccess">Data Upload</RouterLink> -->
                <RouterLink v-if="isMember" to="/schedule" class="nav-link nav-link-mobile">Schedule</RouterLink>
                <RouterLink to="/data-status" class="nav-link nav-link-mobile">Data Status</RouterLink>
                <RouterLink v-if="isLead" to="/strategy" class="nav-link nav-link-mobile">Match Strategy</RouterLink>

                <button v-if="isMember" type="button" class="nav-group-label" @click.stop="toggleGroup('scouting')">
                    <span class="nav-group-chevron" :class="{ 'nav-group-chevron--open': expandedGroup === 'scouting' }">▾</span>
                    Scouting
                </button>
                <template v-if="isMember && expandedGroup === 'scouting'">
                    <RouterLink to="/prescout" class="nav-link nav-link-mobile nav-link-grouped">Prescouting</RouterLink>
                    <RouterLink to="/pit" class="nav-link nav-link-mobile nav-link-grouped">Pit Scouting</RouterLink>
                    <RouterLink to="/match" class="nav-link nav-link-mobile nav-link-grouped">Match Scouting</RouterLink>
                </template>

                <!-- <RouterLink to="/event" class="nav-link nav-link-mobile">Event Analysis</RouterLink> -->
                <button type="button" class="nav-group-label" @click.stop="toggleGroup('analysis')">
                    <span class="nav-group-chevron" :class="{ 'nav-group-chevron--open': expandedGroup === 'analysis' }">▾</span>
                    Analysis
                </button>
                <template v-if="expandedGroup === 'analysis'">
                    <RouterLink to="/team" class="nav-link nav-link-mobile nav-link-grouped">Team Analysis</RouterLink>
                    <RouterLink to="/stats" class="nav-link nav-link-mobile nav-link-grouped">Stats</RouterLink>
                </template>

                <button type="button" class="nav-group-label" @click.stop="toggleGroup('allianceSelection')">
                    <span class="nav-group-chevron" :class="{ 'nav-group-chevron--open': expandedGroup === 'allianceSelection' }">▾</span>
                    Alliance Selection
                </button>
                <template v-if="expandedGroup === 'allianceSelection'">
                    <RouterLink v-if="isMember" to="/pickem" class="nav-link nav-link-mobile nav-link-grouped">Pick'em</RouterLink>
                    <RouterLink v-if="isMember" to="/picklist" class="nav-link nav-link-mobile nav-link-grouped">Pick List</RouterLink>
                    <RouterLink to="/playoffs" class="nav-link nav-link-mobile nav-link-grouped">Playoffs</RouterLink>
                </template>

                <!-- <RouterLink to="/chartbuilder" class="nav-link nav-link-mobile">ChartBuilder</RouterLink> -->
            </template>
        </HamburgerMenu>

    </div>
    <div class="nav" :class="{ 'nav--hidden': navHidden }" v-else>
        <HamburgerMenu>
            <template v-slot:menu-title>
                <RouterLink to="/" class="nav-link">GreyScout</RouterLink>
            </template>
            <template v-slot:theme-button>
                <div class="nav-dark-mode nav-mobile-right" @click="toggleUserDarkMode">
                    <md-icon slot="icon" v-if="isDarkMode">dark_mode</md-icon>
                    <md-icon slot="icon" v-else>light_mode</md-icon>
                </div>
            </template>
            <template v-slot:menu-content>
                <RouterLink to="/login" class="nav-link nav-link-mobile">Login</RouterLink>
                <RouterLink to="/register" class="nav-link nav-link-mobile">Register</RouterLink>
            </template>
        </HamburgerMenu>
    </div>
</template>

<script lang="ts">
export default {
    props: {
        searchVisible: {
            default: true,
            type: Boolean
        }
    },
    data() {
        return {
            windowWidth: window.innerWidth,
            viewMode: null,
            eventStore: null,
            authStore: null,
            queueStore: null,
            isOnline: navigator.onLine,
            // Hidden while scrolling down, shown again while scrolling up —
            // see handleScroll below.
            navHidden: false,
            lastScrollTop: 0,
            scrollContainer: null,
            // Collapsed by default to keep the menu short — expanding is an
            // explicit choice, not the default state. Accordion-style: only
            // one group ('scouting' | 'analysis' | 'allianceSelection') open at once.
            expandedGroup: null
        }
    },
    created() {
        this.viewMode = useViewModeStore();
        this.eventStore = useEventStore();

        this.authStore = useAuthStore();
        this.authStore.checkUser();

        this.queueStore = useOfflineQueueStore();

        window.addEventListener('online', () => { this.isOnline = true; });
        window.addEventListener('offline', () => { this.isOnline = false; });
    },
    mounted() {
        // The whole SPA scrolls inside #app (position: fixed + overflow:
        // auto in main.css), not the window — window scroll events never
        // fire here, so the listener has to target #app directly.
        this.scrollContainer = document.getElementById('app') || document.scrollingElement || document.documentElement;
        this.scrollContainer.addEventListener('scroll', this.handleScroll, { passive: true });
    },
    beforeUnmount() {
        this.scrollContainer?.removeEventListener('scroll', this.handleScroll);
    },
    computed: {
        eventName() {
            return this.eventStore?.eventName;
        },
        isDarkMode() {
            return this.viewMode.isDarkMode;
        },
        isLoggedIn() {
            return this.authStore?.isUserLoggedIn;
        },
        isWriteAccess() {
            return this.authStore?.isWriteAuthorized;
        },
        isMember() {
            return this.authStore?.isMember;
        },
        isLead() {
            return this.authStore?.isLead;
        }
    },
    methods: {
        // Hides the nav while scrolling down (past its own height, so it
        // never hides right at the top of a short page), shows it again on
        // any scroll up — a small dead zone (SCROLL_DELTA) ignores jitter
        // from momentum/rubber-band scrolling so it doesn't flicker.
        handleScroll() {
            const SCROLL_DELTA = 4;
            const NAV_HEIGHT = 65;
            const scrollTop = Math.max(0, this.scrollContainer.scrollTop);
            const delta = scrollTop - this.lastScrollTop;

            if (scrollTop <= NAV_HEIGHT) {
                this.navHidden = false;
            } else if (delta > SCROLL_DELTA) {
                this.navHidden = true;
            } else if (delta < -SCROLL_DELTA) {
                this.navHidden = false;
            }

            this.lastScrollTop = scrollTop;
        },
        toggleUserDarkMode() {
            this.viewMode.toggleUserDarkMode();
        },
        toggleGroup(name) {
            this.expandedGroup = this.expandedGroup === name ? null : name;
        }
    }
}
</script>

<style scoped>
div.nav {
    background-color: var(--header-color);
    color: var(--primary-text-color);
    top: 0;
    left: 0;
    right: 0;
    z-index: 9999;
    width: 100%;
    height: 65px;
    position: fixed;
    display: block;
    transform: translateY(0);
    transition: transform 0.3s ease;
}

div.nav.nav--hidden {
    transform: translateY(-100%);
}


a.nav-link {
    /* Color transitions */
    transition: color .5s ease;
    transition: background-color .5s ease;
    -ms-transition: color .5s ease;
    -ms-transition: background-color .5s ease;
    -moz-transition: color .5s ease;
    -moz-transition: background-color .5s ease;
    -webkit-transition: color .5s ease;
    -webkit-transition: background-color .5s ease;

    /* Border transitions */
    /* -webkit-transition: border .5s ease;
    -moz-transition: border .5s ease;
    transition: border .5s ease; */

    /* Positioning */
    position: relative;
    margin: 0 auto;
    float: left;
    display: flex;
    justify-content: center;
    align-items: center;

    /* Sizing */
    font-size: 16px;
    height: 100%;
    text-align: center;
    margin: 0 auto;
    padding-left: 10px;
    padding-right: 10px;

    /* Text */
    text-decoration: none;
}


a.nav-link:link,
a.nav-link:visited {
    background-color: var(--header-color);
    color: #FFF;
    border-bottom: var(--header-color) 5px solid;
}

a.nav-link:hover,
a.nav-link:active {
    background-color: var(--header-hover-color);
    color: #FFF;
    border-bottom: var(--primary-color) 5px solid;
}

a.nav-link-mobile {
    width: 100%;
    /* a.nav-link's `height: 100%` and `float: left` are for the links in the
       top bar. Inside the dropdown they must not apply: a percentage height
       there resolves against the (tall) menu on some engines — iOS WebKit —
       stretching every link to the height of the whole menu. Size each row
       from its content instead, at a normal tap-target height. */
    height: auto;
    float: none;
    box-sizing: border-box;
    min-height: 48px;
    padding: 12px 15px;
    line-height: 1.3;
}

.nav-group-label {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
    width: 100%;
    box-sizing: border-box;
    height: auto;
    min-height: 48px;
    line-height: 1.3;
    /* iOS gives <button>s a native look with its own sizing unless reset. */
    -webkit-appearance: none;
    appearance: none;
    padding: 12px 15px;
    /* Same solid color and text styling as a top-level link — the header
       reads as a normal menu row, distinguished only by its chevron. */
    background-color: var(--header-color);
    border: none;
    cursor: pointer;
    font: inherit;
    font-size: 16px;
    color: #FFF;
    text-align: center;
}

.nav-group-label:hover {
    background-color: var(--header-hover-color);
}

.nav-group-chevron {
    display: inline-block;
    font-size: 14px;
    transition: transform 0.15s ease;
}

.nav-group-chevron--open {
    transform: rotate(180deg);
}

a.nav-link-grouped {
    padding-left: 30px;
    font-size: 16px;
    background-color: var(--header-color);
}

a.nav-link-grouped:hover {
    background-color: var(--header-hover-color);
}

.nav-mobile-right {
    display: flex;
    align-items: center;
    float: right;
    position: relative;
    /* height:100% here resolved against an auto-height ancestor (no
       explicit height on .hamburger-container), so it collapsed to
       content size instead of the bar's actual 65px — a 1px-short button.
       Pin it explicitly, border-box so the padding doesn't push past it. */
    box-sizing: border-box;
    height: 65px;
    padding: 20px;
}

.nav-dark-mode {
    background-color: var(--primary-color);
    color: var(--header-theme-toggle-text-color);
    cursor: pointer;
    text-decoration: none;
}

.nav-dark-mode:hover {
    background-color: var(--header-auxillary-button-hover-color);
}

.nav-online-dot {
    /* Sits on top of the account icon as a badge, rather than as its own
       column between it and the theme toggle — parent is position:relative
       via .nav-mobile-right. */
    position: absolute;
    top: 14px;
    right: 14px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
    padding: 0;
    background-color: var(--accent-color);
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.25);
}

.nav-online-dot--online {
    background-color: #3ab83a;
    box-shadow: 0 0 0 2px rgba(58, 184, 58, 0.35);
}

.nav-online-dot--offline {
    background-color: #e05050;
    box-shadow: 0 0 0 2px rgba(224, 80, 80, 0.35);
}
</style>