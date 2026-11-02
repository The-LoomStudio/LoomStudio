import { afterEach, describe, expect, it, vi } from 'vitest'

const entry = '../../../apps/studio-client/src/shared/i18n/index.js'

afterEach(() => {
  vi.doUnmock('../../../apps/studio-client/src/shared/i18n/en-us.js')
  vi.resetModules()
})

describe('locale loading', () => {
  it('keeps Chinese available and loads other languages before translation', async () => {
    vi.resetModules()
    const { createTranslator, loadLocale } = await import(entry)
    expect(createTranslator('zh-CN')('sessions.character')).toBeTruthy()
    expect(() => createTranslator('ja-JP')).toThrow('has not been loaded')

    await loadLocale('ja-JP')
    const { jaJP } = await import('../../../apps/studio-client/src/shared/i18n/ja-jp.js')
    expect(createTranslator('ja-JP')('sessions.character')).toBe(jaJP['sessions.character'])
    expect(() => createTranslator('en-US')).toThrow('has not been loaded')
  })

  it('exposes a failed download without installing an incorrect dictionary', async () => {
    vi.resetModules()
    vi.doMock('../../../apps/studio-client/src/shared/i18n/en-us.js', () => { throw new Error('Locale download failed') })
    const { createTranslator, loadLocale } = await import(entry)
    await expect(loadLocale('en-US')).rejects.toThrow()
    expect(() => createTranslator('en-US')).toThrow('has not been loaded')
    expect(createTranslator('zh-CN')('sessions.character')).toBeTruthy()
  })
})
