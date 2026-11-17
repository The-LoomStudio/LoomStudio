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
    case 'client':
      return [
        'tests/unit/client/**/*.test.ts',
        'tests/integration/client/**/*.test.ts',
      ]
    case 'stress':
      return ['tests/stress/**/*.test.ts']
    case 'probes':
      return ['tests/probes/**/*.test.ts']
    case 'extensions':
      return ['tests/extensions/**/*.test.ts']
    case undefined:
      return defaultTestInclude
    default:
      throw new Error(`Unknown LOOM_TEST_SCOPE: ${scope}`)
  }
}
const scopedTestInclude = resolveScopedInclude(testScope)

const resolvePath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@loom-studio/shared/id': resolvePath('./packages/shared/src/id.ts'),
      '@loom-studio/shared/tokenizer/contracts': resolvePath('./packages/shared/src/tokenizer/contracts.ts'),
      '@loom-studio/shared/tokenizer/async': resolvePath('./packages/shared/src/tokenizer/async-counter.ts'),
      '@loom-studio/shared/tokenizer': resolvePath('./packages/shared/src/tokenizer/index.ts'),
      '@loom-studio/ai-gateway/contracts': resolvePath('./packages/ai-gateway/src/contracts.ts'),
      '@loom-studio/ai-gateway': resolvePath('./packages/ai-gateway/src/index.ts'),
      '@loom-studio/application-runtime/data': resolvePath('./packages/application-runtime/src/data/index.ts'),
      '@loom-studio/application-runtime/artifacts': resolvePath('./packages/application-runtime/src/artifacts.ts'),
      '@loom-studio/application-runtime': resolvePath('./packages/application-runtime/src/index.ts'),
      '@loom-studio/extension-sdk': resolvePath('./packages/extension-sdk/src/index.ts'),
      '@loom-studio/kernel/diagnostics': resolvePath('./packages/kernel/src/diagnostics/index.ts'),
      '@loom-studio/kernel/data-engine': resolvePath('./packages/kernel/src/data-engine/index.ts'),
      '@loom-studio/kernel/asset-store': resolvePath('./packages/kernel/src/asset-store/index.ts'),
      '@loom-studio/kernel/secret-store': resolvePath('./packages/kernel/src/secret-store/index.ts'),
      '@loom-studio/kernel/document-store': resolvePath('./packages/kernel/src/document-store/index.ts'),
      '@loom-studio/kernel/extension-host': resolvePath('./packages/kernel/src/extension-host/index.ts'),
      '@loom-studio/kernel/extension-manager': resolvePath('./packages/kernel/src/extension-manager/index.ts'),
      '@loom-studio/kernel/platform': resolvePath('./packages/kernel/src/platform/index.ts'),
      '@loom-studio/kernel/script-runtime': resolvePath('./packages/kernel/src/script-runtime/index.ts'),
      '@loom-studio/kernel': resolvePath('./packages/kernel/src/index.ts'),
      '@loom-studio/logging/node': resolvePath('./packages/logging/src/node.ts'),
      '@loom-studio/logging': resolvePath('./packages/logging/src/index.ts'),
      '@loom-studio/ui': resolvePath('./packages/loom-ui/src/index.ts'),
      '@loom-studio/shared/loom-scripts': resolvePath('./packages/shared/src/loom-script-contracts.ts'),
      '@loom-studio/shared/tool-mounts': resolvePath('./packages/shared/src/tool-mount-contracts.ts'),
      '@loom-studio/shared/macros': resolvePath('./packages/shared/src/macros.ts'),
      '@loom-studio/shared': resolvePath('./packages/shared/src/index.ts'),
    },
  },
  test: {
    setupFiles: [resolvePath('./tests/support/client/load-locales.ts')],
    include: scopedTestInclude,
    exclude: testScope ? ['**/node_modules/**', '**/dist/**'] : defaultTestExclude,
    passWithNoTests: false,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
})
