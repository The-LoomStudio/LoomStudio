import type { ClientJsonValue } from '@loom-studio/client-bridge'
import type { MutationReceipt } from './common.js'
import type { Card } from './card.js'
import type { ContextAssetNode } from './context-asset.js'

export type CardBundleArtifact = {
  schemaVersion: 1
  artifactId: string
  displayName: string
  description?: string
  card: {
    name: string
    userName?: string
    description?: string
    preset?: ClientJsonValue
    opening?: ClientJsonValue
    settingLayer?: ClientJsonValue
  }
  contextAssets: ContextAssetNode[]
  metadata?: Record<string, ClientJsonValue>
}

export type PromptResource = {
  id: string
  version: number
  resourceKind: 'preset' | 'setting' | 'logic' | 'runtime' | 'history' | 'prompt'
  rootNode: ContextAssetNode
  sourceArtifactRef?: ClientJsonValue
  createdAt: string
  updatedAt: string
}

export type ImportBundle = {
  id: string
  version: number
  cardId: string
  documentIds: string[]
  sourceArtifact: CardBundleArtifact
  sourceArtifactRef: ClientJsonValue
  bindings: ClientJsonValue[]
  importedAt: string
}

export type GetImportBundleResult = {
  importBundle: ImportBundle
}

export type GetPromptResourceResult = {
  resource: PromptResource
}

export type ListCardPromptResourcesResult = {
  resources: PromptResource[]
}

export type UpdatePromptResourceResult = {
  resource: PromptResource
  mutation: MutationReceipt
}

export type ImportCardBundleResult = {
  card: Card
  importBundle: ImportBundle
}

export type ExportCardBundleResult = {
  artifact: CardBundleArtifact
}
