import type { PromptActivation } from './prompt-activation.js'
import type { ChatMessage } from '@loom-studio/shared'

export type PromptProviderRole = 'system' | 'developer' | 'assistant' | 'user'
export type PromptSourceKind = 'preset' | 'settingLayer' | 'narrativeChat' | 'narrativeHistory' | 'sessionHistory' | 'runtime'

export type PromptCompositionCapabilities = {
  activation?: PromptActivation
  targetAnchorId?: string 
  localDepth?: number 
  roleHint?: PromptProviderRole 
}

export type PromptContribution = {
  id: string
  sourceRef: {
    kind: PromptSourceKind
    sourceId: string
    sourceNodeId: string
  }
  content: string
  messages?: ChatMessage[]
  capabilities: PromptCompositionCapabilities
}

export type PromptFragment = {
  id: string
  source: PromptContribution['sourceRef']
  content: string
  messages?: ChatMessage[]
  role: PromptProviderRole
  targetAnchorId?: string
  localDepth?: number
}

export type CompiledMessage = ChatMessage & {
  content: string
  fragmentIds: string[]
}

export type EditorProjection = {
  sourceRows: Array<{
    active: boolean
    activationReason: string
    fragmentId: string
    sourceNodeId: string
    sourcePath: string
    targetAnchorId?: string
  }>
  promptRows: Array<{
    targetAnchorId?: string
    fragmentIds: string[]
    role: PromptProviderRole
  }>
}

export type CompiledPrompt = {
  messages: CompiledMessage[]
  editorProjection: EditorProjection
}

export type SourceNode = {
  id: string
  sourceId: string
  parentId: string | null
  displayName: string
  orderIndex: number
  kind: 'module' | 'folder' | 'entry' | 'script' | 'virtual' | 'slot' | 'message' | (string & {})
  meta?: string
  body?: string
  enabled?: boolean
  capabilities?: {
    activation?: PromptActivation
    targetAnchorId?: string
    localDepth?: number
    roleHint?: PromptProviderRole
    [key: string]: unknown
  }
}
