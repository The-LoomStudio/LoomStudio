import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import { buildRenderingLabSample } from '../../../apps/studio-client/src/features/rendering-lab/model/rendering-lab-sample.js'
import { describe, expect, it } from 'vitest'

describe('rendering lab sample model', () => {
  it('builds inline closeup parts outside widget code', () => {
    const sample = buildRenderingLabSample('inline-artifact', createTranslator('en-US'))

    expect(sample.surface).toBe('narrative')
    expect(sample.parts).toHaveLength(3)
    expect(sample.parts[1]).toEqual({
      type: 'artifact',
      artifactType: 'closeup',
      content: 'Her fingertips touch the rim of the cup, as if she is hesitating.',
      renderMode: 'inline',
    })
  })
})
