import { build } from 'vite'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('./', import.meta.url))
await build({ configFile: false, root: fileURLToPath(new URL('../../../', import.meta.url)), publicDir: false, define: { 'process.env.NODE_ENV': JSON.stringify('production') }, build: {
  rolldownOptions: { external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', '@loom-studio/ui'] },
  outDir: root, emptyOutDir: false, minify: true,
  lib: { entry: root + 'ui/entry.tsx', formats: ['es'], fileName: () => 'client.js' },
} })
