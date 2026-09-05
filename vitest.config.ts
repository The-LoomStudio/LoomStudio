import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const testScope = process.env.LOOM_TEST_SCOPE
const defaultTestInclude = [
  'tests/unit/**/*.test.ts',
  'tests/contract/**/*.test.ts',
  'tests/integration/**/*.test.ts',
  'tests/regression/**/*.test.ts',
]
const defaultTestExclude = [
  '**/node_modules/**',
  '**/dist/**',
  'tests/probes/**/*.test.ts',
]
const scopedTestInclude =
  testScope === 'probes'
    ? ['tests/probes/**/*.test.ts']
    : defaultTestInclude

const resolvePath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@loom-studio/ai-gateway': resolvePath('./packages/ai-gateway/src/index.ts'),
      '@loom-studio/agent-store': resolvePath('./packages/agent-store/src/index.ts'),
      '@loom-studio/client-bridge': resolvePath('./packages/client-bridge/src/index.ts'),
      '@loom-studio/diagnostics': resolvePath('./packages/diagnostics/src/index.ts'),
      '@loom-studio/data-engine': resolvePath('./packages/data-engine/src/index.ts'),
      '@loom-studio/blob-store': resolvePath('./packages/blob-store/src/index.ts'),
      '@loom-studio/asset-store': resolvePath('./packages/asset-store/src/index.ts'),
      '@loom-studio/document-store': resolvePath('./packages/document-store/src/index.ts'),
      '@loom-studio/application-runtime': resolvePath('./packages/application-runtime/src/index.ts'),
      '@loom-studio/extension-host': resolvePath('./packages/extension-sdk/extension-host/src/index.ts'),
      '@loom-studio/extension-sdk': resolvePath('./packages/extension-sdk/src/index.ts'),
      '@loom-studio/kernel': resolvePath('./packages/kernel/src/index.ts'),
      '@loom-studio/logging/node': resolvePath('./packages/logging/src/node.ts'),
      '@loom-studio/logging': resolvePath('./packages/logging/src/index.ts'),
      '@loom-studio/narrative-store': resolvePath('./packages/narrative-store/src/index.ts'),
      '@loom-studio/state-store': resolvePath('./packages/state-store/src/index.ts'),
      '@loom-studio/prompt-resource-store': resolvePath('./packages/prompt-resource-store/src/index.ts'),
      '@loom-studio/loom-runner': resolvePath('./packages/loom-runner/src/index.ts'),
      '@loom-studio/shared': resolvePath('./packages/shared/src/index.ts'),
      '@loom-studio/trace-audit': resolvePath('./packages/trace-audit/src/index.ts'),
      '@loom-studio/transport': resolvePath('./packages/transport/src/index.ts'),
      '@loom-studio/sillytavern-importer': resolvePath('./extensions/sillytavern-importer/src/index.ts'),
      '@loom/core': resolvePath('./packages/core/src/index.ts'),
    },
  },
  test: {
    include: scopedTestInclude,
    exclude: testScope ? ['**/node_modules/**', '**/dist/**'] : defaultTestExclude,
    passWithNoTests: true,
  },
})
