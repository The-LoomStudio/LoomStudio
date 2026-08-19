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
  readOnly?: boolean
  skeletonPatch?: {
    items?: PromptCompositionItem[]
    zones?: Array<{
      id: string
      parentId: string | null
      displayName: string
      band: 'stable-prefix' | 'narrative' | 'lower-context' | 'current-turn' | 'fresh-tail'
      orderIndex: number
      accepts?: Array<'preset' | 'settingLayer' | 'narrativeChat' | 'narrativeHistory' | 'sessionHistory' | 'runtime'>
      renderHint?: {
        providerRoleHint?: 'system' | 'developer' | 'assistant' | 'user'
        wrapper?: 'section' | 'message'
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
    bindingId?: string
    zoneId: string
    order?: string
    reason?: string
    slotKey?: string
    slotOrderHint?: number
    sourceKind?: 'actual' | 'virtual'
  }
}

export type PromptProviderRole = 'system' | 'developer' | 'assistant' | 'user'

export type PromptCompositionItemBase = {
  id: string
  orderIndex: number
  displayName: string
  activation?: unknown
  renderHint?: {
    providerRoleHint?: PromptProviderRole
    wrapper?: 'section' | 'message'
  }
}

export type PromptCompositionZone = PromptCompositionItemBase & {
  kind: 'zone'
  parentId: string | null
  band: 'stable-prefix' | 'narrative' | 'lower-context' | 'current-turn' | 'fresh-tail'
  accepts?: Array<'preset' | 'settingLayer' | 'narrativeChat' | 'narrativeHistory' | 'sessionHistory' | 'runtime'>
}

export type PromptCompositionSlot = PromptCompositionItemBase & {
  kind: 'slot'
  bindingId: string
  zoneId?: string
  messageMode?: 'context' | 'native'
  slotKey?: string
}

export type PromptCompositionEntry = PromptCompositionItemBase & {
  kind: 'entry'
  source:
    | { kind: 'preset'; nodeId: string }
    | { kind: 'binding'; bindingId: string }
}

export type PromptMessageBlock = PromptCompositionItemBase & {
  kind: 'message'
  role: PromptProviderRole
  items: Array<PromptCompositionZone | PromptCompositionSlot | PromptCompositionEntry>
}

export type PromptCompositionItem = PromptMessageBlock | PromptCompositionZone | PromptCompositionSlot | PromptCompositionEntry

export type PromptActivationCapability = {
  activations?: PromptActivationCapability[]
  conditions?: Array<{ fact: string; equals?: string | number | boolean; includes?: string }>
  kind: string
  keywords?: string[]
}
