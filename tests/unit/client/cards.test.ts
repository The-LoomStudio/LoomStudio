import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import { readCardCreateInput, readCardName } from '../../../apps/studio-client/src/features/cards/model/use-cards.js'
import { describe, expect, it } from 'vitest'

describe('cards model', () => {
  it('maps card json to create-card input', () => {
    const input = readCardCreateInput(JSON.stringify({
      name: 'Loom Card',
      userName: '调查员',
      description: 42,
      preset: { system: 'Stay in scene.' },
      opening: { entries: [] },
      setting: ['ignored'],
      settingLayer: { entries: [] },
    }), createTranslator('en-US'))

    expect(input).toEqual({
      name: 'Loom Card',
      userName: '调查员',
      preset: { system: 'Stay in scene.' },
      opening: { entries: [] },
      settingLayer: { entries: [] },
    })
  })

  it('rejects cards without a string name', () => {
    expect(() => readCardCreateInput(JSON.stringify({ name: '' }), createTranslator('en-US'))).toThrow('Card JSON requires string field')
  })

  it('reads the initial card name for demo selection', () => {
    expect(readCardName(JSON.stringify({ name: 'Demo' }))).toBe('Demo')
    expect(readCardName(JSON.stringify({ name: 1 }))).toBeUndefined()
  })
})
