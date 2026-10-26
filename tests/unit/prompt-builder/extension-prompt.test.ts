import type { PromptResource, PromptResourceStore } from '@loom-studio/application-data'
import { createVariableRenderContext } from '@loom-studio/shared'
import { describe, expect, it, vi } from 'vitest'
import { buildExtensionPrompt, readExtensionPromptInputs } from '../../../packages/application-runtime/src/prompt/extension-prompt.js'

function loreResource(metadata: PromptResource['metadata'] = {}): PromptResource {
  return {
    id: 'lore', version: 1, resourceKind: 'lore', rootNodeId: 'lore-root', label: 'Lore', metadata,
    rootNode: { id: 'lore-root', kind: 'entry', category: 'lore', label: 'Lore', body: 'Hi {{user}}', capabilities: { targetAnchorId: '@test' } },
    createdAt: '', updatedAt: '',
  }
}

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
      getResource: vi.fn(async () => loreResource({
        origin: { kind: 'extension-package', packageId: 'other.pkg', installationId: 'other-install' },
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

  it('authorizes and compiles the same Lore read while deduplicating its references', async () => {
    const getResource = vi.fn(async () => loreResource())
    const result = await readExtensionPromptInputs({
      addition: { loreResourceIds: ['lore', 'lore'] },
      promptResources: { getResource } as unknown as PromptResourceStore,
      installations: new Map(), variables: createVariableRenderContext(), sourceId: 'test',
    })
    expect(getResource).toHaveBeenCalledExactlyOnceWith('lore')
    expect(result.contributions[0]?.content).toBe('Hi User')
  })

  it.each([
    [null, 'Lore resource not found: lore'],
    [{ ...loreResource(), resourceKind: 'preset' }, 'Lore resource not found: lore'],
    [loreResource({ origin: { kind: 'extension-package', packageId: 'missing.pkg', installationId: 'missing' } }), 'Lore resource is not available in this context: lore'],
  ])('rejects missing, wrong-kind, or unavailable Lore: %j', async (resource, message) => {
    const getResource = vi.fn(async () => resource)
    await expect(readExtensionPromptInputs({
      addition: { loreResourceIds: ['lore'] },
      promptResources: { getResource } as unknown as PromptResourceStore,
      installations: new Map(), variables: createVariableRenderContext(), sourceId: 'test',
    })).rejects.toThrow(String(message))
    expect(getResource).toHaveBeenCalledExactlyOnceWith('lore')
  })
})
