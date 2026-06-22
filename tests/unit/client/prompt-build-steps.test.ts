import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import { buildPromptBuildSteps } from '../../../apps/studio-client/src/features/prompt-build/model/build-prompt-build-steps.js'
import { describe, expect, it } from 'vitest'

describe('prompt build steps model', () => {
  it('derives setting activation counts outside widget code', () => {
    const steps = buildPromptBuildSteps({
      input: 'rain at the counter',
      timeline: [],
      session: {
        id: 'session-alpha-001',
        version: 1,
        cardSourceVersionId: 'card@1',
        cardSnapshot: {
          name: 'Rain Card',
          settingLayer: {
            entries: [
              { id: 'always', content: 'Always on.' },
              { id: 'rain', content: 'Rain entry.', activation: { kind: 'keyword', keywords: ['rain'] } },
              { id: 'manual', content: 'Manual only.', activation: { kind: 'manual' } },
            ],
          },
        },
        activeBranchId: 'branch-alpha-001',
        createdAt: '2026-06-22T00:00:00.000Z',
        updatedAt: '2026-06-22T00:00:00.000Z',
      },
    }, createTranslator('en-US'))

    const activationStep = steps.find(step => step.title === '2. Activation Pass')

    expect(activationStep?.rows.find(row => row.label === 'Setting Layer')?.value).toBe('2 active / 1 inactive')
    expect(activationStep?.rows.find(row => row.label === 'Active Entries')?.value).toBe('always, rain')
  })
})
