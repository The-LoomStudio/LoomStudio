import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'

const packageVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string
const studioServerUrl = process.env.STUDIO_SERVER_URL ?? 'http://127.0.0.1:4173'

export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  define: {
    __LOOM_STUDIO_VERSION__: JSON.stringify(packageVersion),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
      '@loom-studio/logging': new URL('../../packages/logging/src/index.ts', import.meta.url).pathname,
    },
  },
  css: {
    modules: {
      generateScopedName: 'airp__[name]__[local]',
    },
    preprocessorOptions: {
      scss: {
        additionalData: `@use "@/styles/abstracts" as *;`,
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/auth': studioServerUrl,
      '/assets': studioServerUrl,
      '/cards': studioServerUrl,
      '/extensions': studioServerUrl,
      '/rpc': studioServerUrl,
    },
  },
})
