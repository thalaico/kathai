import { defineConfig, type Plugin } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'

/**
 * Dev-only mirror of netlify/edge-functions/epub.ts. Lets `bun run dev`
 * serve /api/epub without needing `netlify dev`.
 */
const ALLOWED_EPUB_HOSTS = new Set([
  'www.gutenberg.org',
  'gutenberg.org',
  'www.gutenberg.net.au',
])

function devEpubProxy(): Plugin {
  return {
    name: 'kathai-dev-epub-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/epub', async (req, res) => {
        try {
          const u = new URL(req.url ?? '', 'http://localhost')
          const target = u.searchParams.get('url')
          if (!target) {
            res.statusCode = 400
            res.end('missing ?url=')
            return
          }
          let upstreamUrl: URL
          try {
            upstreamUrl = new URL(target)
          } catch {
            res.statusCode = 400
            res.end('invalid url')
            return
          }
          if (
            upstreamUrl.protocol !== 'https:' ||
            !ALLOWED_EPUB_HOSTS.has(upstreamUrl.hostname)
          ) {
            res.statusCode = 403
            res.end('host not allowed')
            return
          }
          const upstream = await fetch(upstreamUrl.toString(), { redirect: 'follow' })
          res.statusCode = upstream.status
          res.setHeader(
            'content-type',
            upstream.headers.get('content-type') ?? 'application/epub+zip',
          )
          res.setHeader('access-control-allow-origin', '*')
          const buffer = Buffer.from(await upstream.arrayBuffer())
          res.end(buffer)
        } catch (err) {
          res.statusCode = 502
          res.end(`proxy error: ${(err as Error).message}`)
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [
    svelte(),
    devEpubProxy(),
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
            // Proxied EPUB downloads — cache once, keep offline.
            urlPattern: ({ url }) => url.pathname === '/api/epub',
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
