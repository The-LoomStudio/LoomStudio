import type { PromptResourceStore } from '@loom-studio/application-data'
import { createVariableRenderContext } from '@loom-studio/shared'
import { describe, expect, it, vi } from 'vitest'
import { readExtensionPromptInputs } from '../../../packages/application-runtime/src/prompt/extension-prompt.js'

describe('extension prompt resource authorization', () => {
  it('rejects another installation even when the resource is available in the context', async () => {
    const promptResources = {
      getResource: vi.fn(async () => ({
        resourceKind: 'setting',
        metadata: {
          origin: { kind: 'extension-package', packageId: 'other.pkg', installationId: 'other-install' },
        },
      })),
    } as unknown as PromptResourceStore
    await expect(readExtensionPromptInputs({
      addition: { settingResourceIds: ['other-setting'] },
      promptResources,
      installations: new Map([['other-install', 'other.pkg'], ['own-install', 'own.pkg']]),
      variables: createVariableRenderContext(),
      sourceId: 'test',
      ownerInstallationId: 'own-install',
      ownerPackageId: 'own.pkg',
    })).rejects.toThrow('not owned')
  })
})
