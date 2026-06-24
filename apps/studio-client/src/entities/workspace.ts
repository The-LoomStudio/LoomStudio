import type { ClientJsonValue } from '@loom-studio/client-bridge'
import type { Card } from './card.js'
import type { ContextAssetNode } from './context-asset.js'

export type PromptWorkspaceArtifact = {
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

export type PromptWorkspace = {
  artifactId: string
  cardId: string
  contextAssets: ContextAssetNode[]
  createdAt: string
  description?: string
  displayName: string
  id: string
  sourceArtifact: PromptWorkspaceArtifact
  updatedAt: string
  version: number
}

export type ImportWorkspaceArtifactResult = {
  workspace: PromptWorkspace
  card: Card
}

export type GetPromptWorkspaceResult = {
  workspace: PromptWorkspace
}

export type ListPromptWorkspacesResult = {
  workspaces: PromptWorkspace[]
  nextCursor?: string
}

export type UpdatePromptWorkspaceResult = {
  workspace: PromptWorkspace
}

export type ExportWorkspaceArtifactResult = {
  artifact: PromptWorkspaceArtifact
}
