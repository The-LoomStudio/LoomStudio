import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'

const resolvePath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))
const packageVersion = JSON.parse(readFileSync(resolvePath('./package.json'), 'utf8')).version as string
const studioServerUrl = process.env.STUDIO_SERVER_URL ?? 'http://127.0.0.1:4173'

export default defineConfig({
  root: resolvePath('.'),
  publicDir: resolvePath('../../public'),
  define: {
    __LOOM_STUDIO_VERSION__: JSON.stringify(packageVersion),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolvePath('./src'),
      '@loom-studio/logging': resolvePath('../../packages/logging/src/index.ts'),
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
