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

  it('summarizes runtime facts and inactive activation reasons from projection rows', () => {
    const steps = buildPromptBuildSteps({
      input: 'finalize',
      timeline: [],
      activationFacts: {
        'agent.mode': 'finalize',
        tags: ['scene:combat'],
      },
      projection: {
        zones: [],
        messages: [],
        editorProjection: {
          sourceRows: [
            {
              active: false,
              activationReason: 'activation: conditions not matched',
              fragmentId: 'setting.draft',
              sourceNodeId: 'node.setting.draft',
              sourcePath: '/Setting/Draft',
              zoneId: 'setting.stable',
              slotKey: 'setting-layer:test@setting.stable',
            },
          ],
          promptRows: [],
        },
      },
    }, createTranslator('en-US'))

    const activationStep = steps.find(step => step.title === '2. Activation Pass')

    expect(activationStep?.rows.find(row => row.label === 'Runtime Facts')?.value).toBe('agent.mode = finalize, tags = scene:combat')
    expect(activationStep?.rows.find(row => row.label === 'Inactive Reasons')?.value).toBe('/Setting/Draft: activation: conditions not matched')
  })

  it('surfaces real core trace status and pass order in the final payload step', () => {
    const steps = buildPromptBuildSteps({
      input: 'hello',
      timeline: [],
      promptBuildTrace: {
        status: 'ok',
        executions: [
          { passName: 'prompt.source.prepared' },
          { passName: 'prompt.compile' },
        ],
      },
    }, createTranslator('en-US'))

    const finalStep = steps.find(step => step.title === '4. Final Payload')

    expect(finalStep?.rows.find(row => row.label === 'Core status')?.value).toBe('ok')
    expect(finalStep?.rows.find(row => row.label === 'Core passes')?.value).toBe('prompt.source.prepared -> prompt.compile')
  })
})
