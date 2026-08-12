import { defineConfig } from 'vitest/config'

const testScope = process.env.LOOM_TEST_SCOPE
const defaultTestInclude = [
  'packages/**/*.test.ts',
  'apps/**/*.test.ts',
  'extensions/**/*.test.ts',
  'tests/unit/**/*.test.ts',
  'tests/contract/**/*.test.ts',
  'tests/integration/**/*.test.ts',
  'tests/regression/**/*.test.ts',
]
const defaultTestExclude = [
  '**/node_modules/**',
  '**/dist/**',
  'tests/archive/**/*.test.ts',
  'tests/probes/**/*.test.ts',
]
const scopedTestInclude =
  testScope === 'archive'
    ? ['tests/archive/**/*.test.ts']
    : testScope === 'probes'
      ? ['tests/probes/**/*.test.ts']
      : defaultTestInclude

export default defineConfig({
  resolve: {
    alias: {
      '@loom-studio/agent-store': new URL('./packages/agent-store/src/index.ts', import.meta.url).pathname,
      '@loom-studio/client-bridge': new URL('./packages/client-bridge/src/index.ts', import.meta.url).pathname,
      '@loom-studio/diagnostics': new URL('./packages/diagnostics/src/index.ts', import.meta.url).pathname,
      '@loom-studio/data-engine': new URL('./packages/data-engine/src/index.ts', import.meta.url).pathname,
      '@loom-studio/document-store': new URL('./packages/document-store/src/index.ts', import.meta.url).pathname,
      '@loom-studio/application-runtime': new URL('./packages/application-runtime/src/index.ts', import.meta.url).pathname,
      '@loom-studio/extension-host': new URL('./packages/extension-sdk/extension-host/src/index.ts', import.meta.url).pathname,
      '@loom-studio/extension-sdk': new URL('./packages/extension-sdk/src/index.ts', import.meta.url).pathname,
      '@loom-studio/kernel': new URL('./packages/kernel/src/index.ts', import.meta.url).pathname,
      '@loom-studio/logging/node': new URL('./packages/logging/src/node.ts', import.meta.url).pathname,
      '@loom-studio/logging': new URL('./packages/logging/src/index.ts', import.meta.url).pathname,
      '@loom-studio/narrative-store': new URL('./packages/narrative-store/src/index.ts', import.meta.url).pathname,
      '@loom-studio/loom-runner': new URL('./packages/loom-runner/src/index.ts', import.meta.url).pathname,
      '@loom-studio/shared': new URL('./packages/shared/src/index.ts', import.meta.url).pathname,
      '@loom-studio/trace-audit': new URL('./packages/trace-audit/src/index.ts', import.meta.url).pathname,
      '@loom-studio/transport': new URL('./packages/transport/src/index.ts', import.meta.url).pathname,
      '@loom/core': new URL('./packages/core/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    include: scopedTestInclude,
    exclude: testScope ? ['**/node_modules/**', '**/dist/**'] : defaultTestExclude,
    passWithNoTests: true,
  },
})
