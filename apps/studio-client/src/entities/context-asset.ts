export type ContextAssetNode = {
  body?: string
  category?: 'preset' | 'setting' | 'logic' | 'runtime' | 'history'
  children?: ContextAssetNode[]
  configRows?: Array<{ label: string; value: string }>
  enabled?: boolean
  id: string
  isSection?: boolean
  kind: 'module' | 'folder' | 'entry' | 'script' | 'virtual' | 'order'
  label: string
  meta?: string
  orderList?: string[]
  skeletonPatch?: {
    zones?: Array<{
      id: string
      parentId: string | null
      key: string
      displayName: string
      band: 'stable-prefix' | 'narrative' | 'lower-context' | 'current-turn' | 'fresh-tail'
      orderIndex: number
      anchors: Array<'before' | 'inside' | 'after'>
      renderHint: {
        providerRoleHint: 'system' | 'assistant' | 'user'
        wrapper: 'section' | 'message'
      }
    }>
    injectionGroups?: Array<{
      key: string
      displayName: string
      targetZoneKey: string
      anchor: 'before' | 'inside' | 'after'
      accepts: Array<'preset' | 'settingLayer' | 'narrativeChat' | 'runtime'>
    }>
  }
  slotRanks?: ProjectionSlotRank[]
  projection?: {
    anchor?: 'before' | 'inside' | 'after'
    entryOrder?: number
    group: string
    lifecycle: string
    order: string
    reason?: string
    slotKey?: string
    slotOrder?: number
    sourceKind?: 'actual' | 'virtual'
    zone: string
  }
  capabilities?: PromptCompositionCapabilities
}

export type ProjectionSlotRank = {
  injectionGroupKey: string
  anchor?: 'before' | 'inside' | 'after'
  slotKey: string
  rankKey: string
}

export type PromptCompositionCapabilities = {
  activation?: { kind: string; keywords?: string[] }
  lifecycle?: { lifecycle: string }
  projection?: {
    anchor?: 'before' | 'inside' | 'after'
    entryOrderHint?: number
    injectionGroupKey: string
    order?: string
    reason?: string
    slotKey?: string
    slotOrderHint?: number
    sourceKind?: 'actual' | 'virtual'
    zone: string
  }
}
