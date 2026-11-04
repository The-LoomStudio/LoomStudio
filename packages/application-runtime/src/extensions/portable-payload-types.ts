import type { JsonObject } from '@loom-studio/shared'

export type PortableExtensionPayloadArtifact = {
  id: string
  packageId: string
  fileName: string
  format: string
  mediaType: string
  schemaVersion?: number
  requirement?: {
    versionRange?: string
  }
  metadata?: JsonObject
  content: string
  resourceOrigin?: 'card' | 'external'
}

export type PortableExtensionPayloadContent = Omit<PortableExtensionPayloadArtifact, 'id'> & {
  ownerInstallationId?: string
  artifactPayloadId: string
  createdAt: string
  updatedAt: string
}
