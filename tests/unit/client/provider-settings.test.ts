import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import { readGatewayModelConfig } from '../../../apps/studio-client/src/features/provider-settings/model/use-provider-settings.js'
import { describe, expect, it } from 'vitest'

describe('provider settings model', () => {
  it('maps camelCase form fields to provider wire config', () => {
    const config = readGatewayModelConfig({
      temperature: '0.7',
      maxTokens: '256',
    }, createTranslator('en-US'))

    expect(config).toEqual({
      temperature: 0.7,
      max_tokens: 256,
    })
  })

  it('rejects invalid numeric model config', () => {
    expect(() => readGatewayModelConfig({
      temperature: 'warm',
      maxTokens: '',
    }, createTranslator('en-US'))).toThrow('Expected number')
  })
})
