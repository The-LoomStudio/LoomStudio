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
  'tests/stress/**/*.test.ts',
]
function resolveScopedInclude(scope?: string): string[] {
  switch (scope) {
    case 'fast':
      return [
        'tests/unit/core/**/*.test.ts',
        'tests/unit/shared/**/*.test.ts',
        'tests/contract/**/*.test.ts',
      ]
    case 'server':
      return [
        'tests/integration/studio-server/**/*.test.ts',
        'tests/unit/studio-server/**/*.test.ts',
      ]
    case 'real':
      return ['tests/integration/pipeline/**/*.test.ts']
    case 'stress':
      return ['tests/stress/**/*.test.ts', 'tests/probes/**/*.test.ts']
    case 'probes':
      return ['tests/probes/**/*.test.ts']
    default:
      return defaultTestInclude
  }
}
const scopedTestInclude = resolveScopedInclude(testScope)

const resolvePath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@loom-studio/ai-gateway': resolvePath('./packages/ai-gateway/src/index.ts'),
      '@loom-studio/ai-gateway/contracts': resolvePath('./packages/ai-gateway/src/contracts.ts'),
      '@loom-studio/application-data': resolvePath('./packages/application-data/src/index.ts'),
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
      '@loom-studio/loom-runner': resolvePath('./packages/loom-runner/src/index.ts'),
      '@loom-studio/ui': resolvePath('./packages/loom-ui/src/index.ts'),
      '@loom-studio/shared/macros': resolvePath('./packages/shared/src/macros.ts'),
      '@loom-studio/shared': resolvePath('./packages/shared/src/index.ts'),
      '@loom-studio/trace-audit': resolvePath('./packages/trace-audit/src/index.ts'),
      '@loom-studio/transport': resolvePath('./packages/transport/src/index.ts'),
      '@loom-studio/sillytavern-importer': resolvePath('./official/extensions/st-data-compat/src/index.ts'),
      '@loom/core': resolvePath('./packages/core/src/index.ts'),
    },
  },
  test: {
    include: scopedTestInclude,
    exclude: testScope ? ['**/node_modules/**', '**/dist/**'] : defaultTestExclude,
    passWithNoTests: true,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
})
