import type { DocumentStore } from '@loom-studio/document-store'
import { applicationDocumentTypes } from './document-types.js'
import { readDocument } from './document-store.js'
import type {
  ProviderModelSelection,
  ProviderProfileContent,
} from './types.js'

export function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} cannot be empty`)
  }
}

export async function assertProviderModelExists(documents: DocumentStore, model: ProviderModelSelection): Promise<void> {
  const profile = await readDocument<ProviderProfileContent>(documents, model.providerProfileId, applicationDocumentTypes.providerProfile)
  if (!profile.content.enabledModelIds.includes(model.modelId)) {
    throw new Error(`Provider model is not enabled: ${model.modelId}`)
  }
}
