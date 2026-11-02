import { expect } from 'vitest'

// Component tests create translators directly, outside the browser bootstrap.
const testPath = (expect.getState().testPath ?? '').replaceAll('\\', '/')
if (testPath.includes('/tests/unit/client/') || testPath.includes('/tests/integration/client/')) {
  const { loadLocale, supportedLocales } = await import('../../../apps/studio-client/src/shared/i18n/index.js')
  await Promise.all(supportedLocales.map(loadLocale))
}
