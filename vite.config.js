import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: { port: 5191 },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // registered in src/pwa.js so we can show "ready offline"
      includeAssets: ['catalog.pdf', 'sounds/*.mp3', 'brand/*', 'icons/*'],
      manifest: {
        name: 'Opsis Catalogue',
        short_name: 'Opsis',
        description: 'Opsis medical catalogue, readable offline.',
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#eef3f7',
        theme_color: '#123c57',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // everything the viewer needs, including the catalogue PDF and page sounds
        globPatterns: ['**/*.{js,mjs,css,html,png,webp,svg,mp3,pdf,woff2}'],
        maximumFileSizeToCacheInBytes: 60 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
});
