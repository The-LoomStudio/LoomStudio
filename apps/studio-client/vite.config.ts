import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig, type PluginOption } from 'vite'

const resolvePath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))
const packageVersion = JSON.parse(readFileSync(resolvePath('./package.json'), 'utf8')).version as string
const studioServerUrl = process.env.STUDIO_SERVER_URL ?? 'http://127.0.0.1:4173'
const analyzeBundle = process.env.LOOM_ANALYZE_BUNDLE === '1'

export default defineConfig({
  root: resolvePath('.'),
  publicDir: resolvePath('../../public'),
  define: {
    __LOOM_STUDIO_VERSION__: JSON.stringify(packageVersion),
  },
  plugins: [
    react(),
    babel({
      presets: [reactCompilerPreset({ compilationMode: 'annotation' })],
    }),
    ...(analyzeBundle ? [visualizer({
      brotliSize: true,
      emitFile: true,
      filename: 'bundle-stats.html',
      gzipSize: true,
      open: false,
      template: 'treemap',
    }) as PluginOption] : []),
  ],
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
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{
            name: 'shared-icons',
            test: /lucide-react\/dist\/esm\/icons\//,
            minShareCount: 2,
          }],
        },
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
