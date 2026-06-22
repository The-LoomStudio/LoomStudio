import type { Branch, Session } from './session.js'

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
      fragmentId: string
      sourceNodeId: string
      sourcePath: string
      injectionGroupKey: string
      slotKey: string
    }>
    promptRows: Array<{
      zoneKey: string
      anchor: 'before' | 'inside' | 'after'
      slotKey: string
      fragmentIds: string[]
      orderSource: 'rank' | 'slotOrderHint' | 'sourceTreeFallback'
    }>
  }
}

export type PromptProjectionZone = {
  zoneKey: string
  displayName: string
  anchor: 'before' | 'inside' | 'after'
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
        injectionGroupKey: string
        lifecycle: string
      }
    }>
  }>
}

export type PromptPreview = {
  session: Session
  branch: Branch
  messages: ProviderMessage[]
  projection?: PromptProjection
}
