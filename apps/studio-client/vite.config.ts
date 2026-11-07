import { regexPreview } from './build/regex-preview.js'
import { extensionSharedModules } from './build/extension-shared-modules.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig, type PluginOption } from 'vite'

const resolvePath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))
const packageVersion = JSON.parse(readFileSync(resolvePath('../../package.json'), 'utf8')).version as string
const studioServerUrl = process.env.STUDIO_SERVER_URL ?? 'http://127.0.0.1:18010'
const clientPort = Number(process.env.PORT ?? 18011)
const analyzeBundle = process.env.LOOM_ANALYZE_BUNDLE === '1'

export default defineConfig({
  root: resolvePath('.'),
  publicDir: resolvePath('../../public'),
  define: {
    __LOOM_STUDIO_VERSION__: JSON.stringify(packageVersion),
  },
  plugins: [
    extensionSharedModules(),
    regexPreview(),
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
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': resolvePath('./src'),
      '@loom-studio/logging': resolvePath('../../packages/logging/src/index.ts'),
      '@loom-studio/ui/styles.css': resolvePath('../../packages/loom-ui/src/styles.css'),
      '@loom-studio/ui': resolvePath('../../packages/loom-ui/src/index.ts'),
    },
  },
  css: {
    postcss: {
      plugins: [{
        postcssPlugin: 'loom-native-layer',
        OnceExit(root, { postcss }) {
          const native = postcss.atRule({ name: 'layer', params: 'loom-native' })
          for (const node of [...root.nodes]) {
            // These directives belong to the stylesheet, not a layer block.
            if (node.type === 'atrule' && (['charset', 'namespace'].includes(node.name) || (node.name === 'layer' && !node.nodes))) continue
            if (node.type === 'atrule' && node.name === 'import') {
              throw node.error('Native CSS imports must resolve during bundling before applying loom-native.')
            }
            native.append(node)
          }
          if (native.nodes?.length) root.append(native)
        },
      }],
    },
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
    assetsDir: 'app-assets',
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
    host: process.env.STUDIO_CLIENT_HOST ?? (process.env.LOOM_DEV_LAN === '1' ? '0.0.0.0' : '127.0.0.1'),
    port: clientPort,
    proxy: {
      '/auth': studioServerUrl,
      '/assets': studioServerUrl,
      '/cards': studioServerUrl,
      '/extensions': studioServerUrl,
      '/trpc': studioServerUrl,
    },
  },
  preview: {
    proxy: Object.fromEntries(['/auth', '/assets', '/cards', '/extensions', '/trpc'].map(path => [path, {
      target: studioServerUrl,
      // Keep the browser's Host and Origin paired for same-origin session checks.
      changeOrigin: false,
    }])),
  },
})
