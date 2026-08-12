import type { DocumentStore } from '@loom-studio/document-store'
import { applicationDocumentTypes } from './document-types.js'
import { readDocument } from './document-store.js'
import type {
  ModelProfileContent,
  ProviderAccountContent,
} from './types.js'

export function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} cannot be empty`)
  }
}

export async function assertProviderAccountExists(documents: DocumentStore, providerAccountId: string): Promise<void> {
  await readDocument<ProviderAccountContent>(documents, providerAccountId, applicationDocumentTypes.providerAccount)
}

export async function assertModelProfileExists(documents: DocumentStore, modelProfileId: string): Promise<void> {
  await readDocument<ModelProfileContent>(documents, modelProfileId, applicationDocumentTypes.modelProfile)
}
