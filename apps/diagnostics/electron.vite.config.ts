import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import type { Plugin } from 'vite'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))
const shared = fileURLToPath(new URL('./src/shared', import.meta.url))

// ssh2 tries two optional native addons, inside try/catch, and does without
// them. Bundled, they'd load outside that try, built for Node rather than
// Electron, and crash the app. Left alone, they fail to load and ssh2 uses
// its plain JavaScript code (fast enough for logs). A plugin rather than
// `build` options because electron-vite's types expect a newer Vite.
function ssh2WithoutNativeAddons(): Plugin {
  return {
    name: 'ssh2-without-native-addons',
    config: () => ({
      build: {
        commonjsOptions: {
          ignore: (id: string) => id === 'cpu-features' || id.endsWith('.node')
        }
      }
    })
  }
}

// Three builds: the main process (Node), the preload script (the bridge
// between the two), and the renderer (the Vue app in the window).
export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    plugins: [ssh2WithoutNativeAddons()]
  },
  preload: {
    resolve: { alias: { '@shared': shared } }
  },
  renderer: {
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version)
    },
    plugins: [
      vue({
        template: {
          compilerOptions: {
            // treat all tags with a dash as custom elements
            isCustomElement: (tag) => tag.includes('-')
          }
        }
      })
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src/renderer/src', import.meta.url)),
        '@shared': shared
      }
    }
  }
})
