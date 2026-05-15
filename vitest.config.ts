import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'extensions/**/*.test.ts', 'tests/**/*.test.ts'],
    passWithNoTests: true,
  },
})
