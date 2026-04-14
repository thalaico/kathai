import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
      $stores: fileURLToPath(new URL('./src/stores', import.meta.url)),
      $components: fileURLToPath(new URL('./src/components', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
})
