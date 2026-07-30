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
      displayName: string
      band: 'stable-prefix' | 'narrative' | 'lower-context' | 'current-turn' | 'fresh-tail'
      orderIndex: number
      accepts?: Array<'preset' | 'settingLayer' | 'narrativeChat' | 'runtime'>
      renderHint: {
        providerRoleHint: 'system' | 'assistant' | 'user'
        wrapper: 'section' | 'message'
      }
    }>
  }
  slotRanks?: ProjectionSlotRank[]
  projection?: {
    entryOrder?: number
    lifecycle: string
    order: string
    reason?: string
    slotKey?: string
    slotOrder?: number
    sourceKind?: 'actual' | 'virtual'
    zoneId: string
  }
  capabilities?: PromptCompositionCapabilities
}

export type ProjectionSlotRank = {
  zoneId: string
  slotKey: string
  rankKey: string
}

export type PromptCompositionCapabilities = {
  activation?: PromptActivationCapability
  lifecycle?: { lifecycle: string }
  projection?: {
    entryOrderHint?: number
    zoneId: string
    order?: string
    reason?: string
    slotKey?: string
    slotOrderHint?: number
    sourceKind?: 'actual' | 'virtual'
  }
}

export type PromptActivationCapability = {
  activations?: PromptActivationCapability[]
  conditions?: Array<{ fact: string; equals?: string | number | boolean; includes?: string }>
  kind: string
  keywords?: string[]
}
