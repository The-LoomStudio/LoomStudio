import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/*.d.ts', '**/*.d.ts.map', 'coverage/**', 'node_modules/**', '.loomstudio-dev/**', '**/*.config.*', 'tests/**', 'scripts/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        console: 'readonly',
        document: 'readonly',
      },
    },
  },
  {
    files: ['packages/kernel/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@loom-studio/application-runtime', '@loom-studio/studio-*', 'apps/*'], message: 'Architecture Guardrail: Kernel cannot depend on higher layers.' }
        ]
      }]
    }
  },
  {
    files: ['packages/application-runtime/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@loom-studio/kernel', '@loom-studio/extension-host', '@loom-studio/transport', '@loom-studio/client-bridge'], message: 'Architecture Guardrail: Application Runtime cannot depend on Kernel, Extension Host, Transport, or Bridge.' }
        ]
      }]
    }
  },
  {
    files: ['packages/extension-sdk/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@loom-studio/kernel', '@loom-studio/extension-host'], message: 'Architecture Guardrail: Extension SDK cannot depend on Kernel or Extension Host.' }
        ]
      }]
    }
  },
  {
    files: ['extensions/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@loom-studio/kernel', '@loom-studio/document-store/src/*'], message: 'Architecture Guardrail: Extensions cannot depend on Kernel or internal implementation details of Document Store.' }
        ]
      }]
    }
  },
  {
    files: ['apps/studio-client/src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['*features/*', '*widgets/*', '*pages/*', '*app/*'], message: 'FSD boundary: shared cannot depend on features, widgets, pages, or app.' },
        ],
      }],
    },
  },
  {
    files: ['apps/studio-client/src/entities/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['*features/*', '*widgets/*', '*pages/*', '*app/*'], message: 'FSD boundary: entities cannot depend on features, widgets, pages, or app.' },
        ],
      }],
    },
  },
  {
    files: ['apps/studio-client/src/features/context-assets/ui/context-asset-search/context-asset-search.tsx'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: reactHooks.configs.flat['recommended-latest'].rules,
  },
)
