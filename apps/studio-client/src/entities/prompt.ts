import type { Branch, Session } from './session.js'
import type { ClientJsonValue } from '@loom-studio/client-bridge'

export type ProviderMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type PromptProjection = {
  zones: PromptProjectionZone[]
  messages: ProviderMessage[]
  editorProjection: {
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
  session: Session
  branch: Branch
  messages: ProviderMessage[]
  promptBuildTrace?: ClientJsonValue
  providerPayloadPreview?: ClientJsonValue
  projection?: PromptProjection
}
