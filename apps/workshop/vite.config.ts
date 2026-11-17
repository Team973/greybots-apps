import { fileURLToPath, URL } from 'node:url'
import { statSync } from 'node:fs'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// The Part sorter's big downloads, by file name: their sizes before
// compression, for its progress bar (a compressed response's
// Content-Length isn't the size its body reads as).
const fileSize = (path: string) => statSync(fileURLToPath(new URL(path, import.meta.url))).size
const partSorterBytes = {
  'ort-wasm-simd-threaded.asyncify.wasm': fileSize('../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm'),
  'ort-wasm-simd-threaded.wasm': fileSize('../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm'),
  'part-sorter.wasm': fileSize('./src/lib/partSorter/part-sorter.wasm'),
  'seg.onnx': fileSize('./src/lib/partSorter/seg.onnx')
}

// https://vitejs.dev/config/
export default defineConfig({
  define: { __PART_SORTER_BYTES__: JSON.stringify(partSorterBytes) },
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
