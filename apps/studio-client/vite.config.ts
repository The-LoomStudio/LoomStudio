import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  plugins: [react()],
  css: {
    modules: {
      generateScopedName: 'airp__[name]__[local]',
    },
  },
  build: {
    rollupOptions: {
      input: {
        host: new URL('index.html', import.meta.url).pathname,
        renderer: new URL('renderer.html', import.meta.url).pathname,
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/rpc': process.env.STUDIO_SERVER_URL ?? 'http://127.0.0.1:4173',
      '/renderer/events': process.env.STUDIO_SERVER_URL ?? 'http://127.0.0.1:4173',
    },
  },
})
