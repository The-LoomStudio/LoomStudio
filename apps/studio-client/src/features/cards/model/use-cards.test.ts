import { describe, expect, it } from 'vitest'
import { createTranslator } from '../../../shared/i18n/index.js'
import { createBlankCardInput } from './use-cards.js'

describe('createBlankCardInput', () => {
  it('creates the minimum valid character card without exposing a raw JSON editor', () => {
    expect(createBlankCardInput(createTranslator('zh-CN'))).toEqual({ name: '新角色' })
  })
})
