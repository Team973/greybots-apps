import { defineStore } from "pinia";

// Desktop/mobile breakpoint. Kept as a local default rather than an
// app-supplied constant so this store has no dependency back on any
// consuming app.
const minWidthForDesktop = 1000;

// A theme the user picked on this device, overriding the OS setting. Apps
// that never call setThemePreference() just follow the OS.
export type ThemePreference = 'system' | 'light' | 'dark';
const themeStorageKey = 'theme_preference';

function loadThemePreference(): ThemePreference {
    try {
        const saved = localStorage.getItem(themeStorageKey);
        if (saved === 'light' || saved === 'dark') return saved;
    } catch {
        // Unreadable storage; follow the OS.
    }
    return 'system';
}

const systemPrefersDark = () => !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

export const useViewModeStore = defineStore('viewMode', {
    state() {
        return {
            screenWidth: window.innerWidth,
            screenHeight: window.innerHeight,
            themePreference: loadThemePreference(),
            darkMode: systemPrefersDark()
        }
    },
    getters: {
        isMobile(): boolean {
            return this.screenWidth <= minWidthForDesktop;
        },
        windowHeight(): number {
            return this.screenHeight;
        },
        isDarkMode(): boolean {
            return this.darkMode;
        },
        themeString(): String {
            return this.darkMode ? "dark" : "light";
        }
    },
    actions: {
        updateScreenWidth(width: number) {
            this.screenWidth = width;
        },
        updateScreenHeight(height: number) {
            this.screenHeight = height;
        },
        updateDarkMode() {
            this.darkMode = this.themePreference === 'system' ? systemPrefersDark() : this.themePreference === 'dark';
            document.querySelector('html')?.setAttribute('theme', this.darkMode ? "dark" : "light");
        },
        // Pick a theme for this device ('system' goes back to following the
        // OS). Remembered across reloads.
        setThemePreference(preference: ThemePreference) {
            this.themePreference = preference;
            try {
                if (preference === 'system') localStorage.removeItem(themeStorageKey);
                else localStorage.setItem(themeStorageKey, preference);
            } catch {
                // Storage unavailable; the choice just won't persist.
            }
            this.updateDarkMode();
        },
        toggleUserDarkMode() {
            this.darkMode = !this.darkMode;
            document.querySelector('html')?.setAttribute('theme', this.darkMode ? "dark" : "light");
        }
    }
});
