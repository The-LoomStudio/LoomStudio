import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import hostConfig from '../../vitest.config.js'

/** Checkout-bound integration harness. Extension suites stay owned by their repository. */
export function defineExtensionTests(configUrl: string) {
  const extensionRoot = dirname(fileURLToPath(configUrl))
  const hostRoot = fileURLToPath(new URL('../../', import.meta.url))
  // Existing server fixtures resolve host assets relative to the checkout.
  process.chdir(hostRoot)
  return defineConfig({
    ...hostConfig,
    root: hostRoot,
    test: {
      ...hostConfig.test,
      include: [resolve(extensionRoot, 'tests/**/*.test.ts')],
      exclude: ['**/node_modules/**', '**/dist/**'],
      passWithNoTests: false,
    },
  })
}
