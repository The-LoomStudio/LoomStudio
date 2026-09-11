import { isCardBundleArtifact, isPromptResourceArtifact, normalizeCardBundleArtifact } from '@loom-studio/application-runtime'
import type { PromptResourceArtifact, RuntimeRequestContext } from '@loom-studio/application-runtime'
import type { Kernel } from '@loom-studio/kernel'
import type { JsonValue } from '@loom-studio/shared'
import { isRecord } from '../rpc/rpc-params.js'

export type PromptResourceConverter = (
  source: JsonValue | undefined,
  name: string | undefined,
  context?: RuntimeRequestContext,
) => Promise<PromptResourceArtifact>

// Only protocol names are bound here; implementations belong to the current Host registration.
export function createExtensionImportConversions(kernel: Pick<Kernel, 'callRpc'>) {
  const promptResource: PromptResourceConverter = async (source, name, context) => {
    const result = await kernel.callRpc('sillytavern.importer.convertPromptResource', {
      source: source ?? null,
      ...(name ? { name } : {}),
    }, context)
    if (!isRecord(result) || !isPromptResourceArtifact(result.artifact)) {
      throw new Error('Import extension returned an invalid Prompt Resource artifact')
    }
    return result.artifact
  }
  return {
    promptResource,
    async cardPng(source: Uint8Array, context?: RuntimeRequestContext) {
      const result = await kernel.callRpc('sillytavern.importer.convertCard', {
        base64: Buffer.from(source).toString('base64'),
      }, context)
      if (!isRecord(result) || !isCardBundleArtifact(result.artifact)) throw new Error('Import extension returned an invalid Card artifact')
      const artifact = normalizeCardBundleArtifact(result.artifact)
      if (result.avatarBase64 !== undefined && typeof result.avatarBase64 !== 'string') {
        throw new Error('Import extension returned an invalid avatar')
      }
      const avatarBytes = typeof result.avatarBase64 === 'string' ? Buffer.from(result.avatarBase64, 'base64') : undefined
      return { artifact, avatarBytes }
    },
  }
}
