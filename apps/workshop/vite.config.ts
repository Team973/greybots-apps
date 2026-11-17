import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
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
  // The Part sorter's worker is an ES module (it imports ONNX Runtime and the
  // C++ module). ONNX Runtime finds its .wasm from its own URL, so it isn't
  // pre-bundled.
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
})
