import type { ClientJsonValue } from '@loom-studio/client-bridge'
import type { ChatMessage } from './agent.js'

export type ProviderMessage = ChatMessage

export type PromptProjection = {
  zones?: PromptProjectionZone[]
  messages: ProviderMessage[]
  messageBlocks?: Array<{
    role: ProviderMessage['role']
    content: string
    messageBlockId?: string
    fragmentIds: string[]
    native?: boolean
  }>
  editorProjection?: {
    sourceRows: Array<{
      active: boolean
      activationReason?: string
      fragmentId: string
      sourceNodeId: string
      sourcePath: string
      zoneId: string
      slotKey: string
    }>
    promptRows: Array<{
      zoneId: string
      slotKey: string
      fragmentIds: string[]
      orderSource: 'rank' | 'slotOrderHint' | 'sourceTreeFallback'
    }>
  }
}

export type PromptProjectionZone = {
  zoneId: string
  displayName: string
  slots: Array<{
    slotKey: string
    orderSource: 'rank' | 'slotOrderHint' | 'sourceTreeFallback'
    fragments: Array<{
      id: string
      content: string
      source: {
        kind: string
        sourceId: string
        sourceNodeId: string
      }
      projection: {
        zoneId: string
        lifecycle: string
      }
    }>
  }>
}

export type PromptPreview = {
  runId: string
  messages: ProviderMessage[]
  providerPayloadPreview?: ClientJsonValue
  projection: PromptProjection
}
