import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon.svg'],
      manifest: {
        name: 'kathai — a reading room',
        short_name: 'kathai',
        description:
          'A quiet EPUB reader with on-device narration. Upload a book or pick one from Project Gutenberg. Works offline.',
        theme_color: '#f4ecd8',
        background_color: '#f4ecd8',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'en',
        start_url: '/',
        scope: '/',
        categories: ['books', 'education', 'productivity'],
        icons: [
          {
            src: '/icon.svg',
            sizes: '192x192 512x512 any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // Cache the app shell + assets up to 5 MB.
        globPatterns: ['**/*.{js,css,html,svg,woff,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            // Gutendex search responses — handy for "recently browsed" offline.
            urlPattern: /^https:\/\/gutendex\.com\/books\//,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'gutendex-v1',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            // Gutenberg EPUB downloads — cache once, keep offline.
            urlPattern: /^https:\/\/www\.gutenberg\.org\/.*\.epub/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gutenberg-epubs-v1',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 90 },
            },
          },
        ],
      },
    }),
  ],
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
