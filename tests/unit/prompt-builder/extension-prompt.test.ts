import type { PromptResourceStore } from '@loom-studio/application-data'
import { createVariableRenderContext } from '@loom-studio/shared'
import { describe, expect, it, vi } from 'vitest'
import { buildExtensionPrompt, readExtensionPromptInputs } from '../../../packages/application-runtime/src/prompt/extension-prompt.js'

describe('extension prompt resource authorization', () => {
  it('returns internal source and macro evidence from the original expansion', async () => {
    const prompt = await buildExtensionPrompt({
      build: { content: [{ targetAnchorId: '@test', content: 'Hi {{user}}' }] },
      promptResources: {} as PromptResourceStore, installations: new Map(),
    })
    expect(prompt.messages.map(message => message.content)).toEqual(['Hi User'])
    expect(prompt.observation?.sources).toContainEqual(expect.objectContaining({
      id: 'extension.prompt.content.0', original: 'Hi {{user}}', rendered: 'Hi User', active: true,
    }))
    expect(prompt.observation?.variables).toContainEqual(expect.objectContaining({
      name: 'user', path: 'computed.user.name', source: 'computed', value: 'User', hostId: 'extension.prompt.content.0', stage: 'source',
    }))
  })

  it('rejects another installation even when the resource is available in the context', async () => {
    const promptResources = {
      getResource: vi.fn(async () => ({
        resourceKind: 'lore',
        metadata: {
          origin: { kind: 'extension-package', packageId: 'other.pkg', installationId: 'other-install' },
        },
      })),
    } as unknown as PromptResourceStore
    await expect(readExtensionPromptInputs({
      addition: { loreResourceIds: ['other-setting'] },
      promptResources,
      installations: new Map([['other-install', 'other.pkg'], ['own-install', 'own.pkg']]),
      variables: createVariableRenderContext(),
      sourceId: 'test',
      ownerInstallationId: 'own-install',
      ownerPackageId: 'own.pkg',
    })).rejects.toThrow('not owned')
  })
})
