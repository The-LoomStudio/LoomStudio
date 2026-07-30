import { evaluatePromptActivation, type ActivationFacts, type PromptActivation } from './prompt-activation.js'

export type PromptProviderRole = 'system' | 'assistant' | 'user'
export type PromptSourceKind = 'preset' | 'settingLayer' | 'narrativeChat' | 'runtime'
export type PromptLifecycle = 'always' | 'conditional' | 'fresh'

export type PromptContentCapability = {
  kind: 'text'
}

export type PromptProjectionCapability = {
  zoneId: string
  sourceSlotKey?: string
  joinSlotKey?: string
  slotOrderHint?: number
  entryOrderHint?: number
}

export type PromptResolutionCapability = {
  semanticSlotKey: string
  policy: 'append' | 'merge' | 'replace' | 'single'
  priorityHint?: number
}

export type PromptLifecycleCapability = {
  lifecycle: PromptLifecycle
}

export type PromptRenderCapability = {
  wrapper?: 'section' | 'message' | 'inline'
  roleHint?: PromptProviderRole
  label?: string
}

export type PromptCompositionCapabilities = {
  content?: PromptContentCapability
  activation?: PromptActivation
  projection?: PromptProjectionCapability
  resolution?: PromptResolutionCapability
  lifecycle?: PromptLifecycleCapability
  render?: PromptRenderCapability
}

export type CompositionSkeleton = {
  id: string
  rootZoneId: string
  zones: ZoneNode[]
  fallbackZoneId: string
}

export type CompositionSkeletonPatch = {
  zones?: ZoneNode[]
  fallbackZoneId?: string
}

export type ZoneNode = {
  id: string
  parentId: string | null
  displayName: string
  band: 'stable-prefix' | 'narrative' | 'lower-context' | 'current-turn' | 'fresh-tail'
  orderIndex: number
  accepts?: PromptSourceKind[]
  renderHint: {
    providerRoleHint: PromptProviderRole
    wrapper: 'section' | 'message'
  }
}

export type SourceNode = {
  id: string
  sourceId: string
  parentId: string | null
  displayName: string
  orderIndex: number
}

export type PromptFragment = {
  id: string
  source: {
    kind: PromptSourceKind
    sourceId: string
    sourceNodeId: string
  }
  content: string
  projection: {
    zoneId: string
    lifecycle: PromptLifecycle
    sourceSlotKey?: string
    joinSlotKey?: string
    slotOrderHint?: number
    entryOrderHint?: number
    activation?: PromptActivation
  }
}

export type PromptContribution = {
  id: string
  sourceRef: {
    kind: PromptSourceKind
    sourceId: string
    sourceNodeId: string
  }
  content: string
  capabilities: PromptCompositionCapabilities
}

export type ProjectionOrderProfile = {
  id: string
  scope: 'global' | 'session'
  skeletonPatch?: CompositionSkeletonPatch
  slotRanks: Array<{
    zoneId: string
    slotKey: string
    rankKey: string
  }>
}

export type CompiledPrompt = {
  zones: CompiledZone[]
  messages: Array<{ role: PromptProviderRole; content: string }>
  editorProjection: EditorProjection
}

export type CompiledZone = {
  zoneId: string
  displayName: string
  slots: CompiledSlot[]
}

export type CompiledSlot = {
  slotKey: string
  fragments: PromptFragment[]
  orderSource: 'rank' | 'slotOrderHint' | 'sourceTreeFallback'
}

export type EditorProjection = {
  sourceRows: Array<{
    active: boolean
    activationReason: string
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
    orderSource: CompiledSlot['orderSource']
  }>
}

export const defaultCompositionSkeleton: CompositionSkeleton = {
  id: 'skeleton.airp-default',
  rootZoneId: 'zone.root',
  fallbackZoneId: 'setting.lower',
  zones: [
    zone('preset.system', 'Preset System', 'stable-prefix', 10, 'system', ['preset', 'runtime']),
    zone('setting.stable', 'Stable Setting', 'stable-prefix', 20, 'system', ['settingLayer']),
    zone('chat.history', 'Narrative History', 'narrative', 30, 'assistant', ['narrativeChat']),
    zone('setting.lower', 'Lower Context Setting', 'lower-context', 40, 'system', ['settingLayer']),
    zone('chat.before', 'Before Current Chat', 'current-turn', 50, 'user', ['settingLayer', 'preset', 'runtime']),
    zone('chat.inside', 'Current Chat', 'current-turn', 60, 'user', ['narrativeChat', 'runtime']),
    zone('chat.after', 'After Current Chat', 'current-turn', 70, 'user', ['settingLayer', 'preset', 'runtime']),
    zone('fresh.tail', 'Fresh Tail', 'fresh-tail', 80, 'system', ['preset', 'settingLayer', 'runtime']),
  ],
}

export const emptyProjectionOrderProfile: ProjectionOrderProfile = {
  id: 'profile.empty',
  scope: 'global',
  slotRanks: [],
}

export function applyCompositionSkeletonPatch(
  skeleton: CompositionSkeleton,
  patch: CompositionSkeletonPatch | undefined,
): CompositionSkeleton {
  if (!patch) return skeleton

  return {
    ...skeleton,
    zones: mergeByKey(skeleton.zones, patch.zones ?? [], zone => zone.id),
    fallbackZoneId: patch.fallbackZoneId ?? skeleton.fallbackZoneId,
  }
}

export function materializePromptFragments(contributions: PromptContribution[]): PromptFragment[] {
  return contributions.map(contribution => {
    const projection = contribution.capabilities.projection
    if (!projection) throw new Error(`Prompt contribution missing projection capability: ${contribution.id}`)

    return {
      id: contribution.id,
      source: contribution.sourceRef,
      content: contribution.content,
      projection: {
        zoneId: projection.zoneId,
        lifecycle: contribution.capabilities.lifecycle?.lifecycle ?? 'always',
        ...(projection.sourceSlotKey ? { sourceSlotKey: projection.sourceSlotKey } : {}),
        ...(projection.joinSlotKey ? { joinSlotKey: projection.joinSlotKey } : {}),
        ...(projection.slotOrderHint !== undefined ? { slotOrderHint: projection.slotOrderHint } : {}),
        ...(projection.entryOrderHint !== undefined ? { entryOrderHint: projection.entryOrderHint } : {}),
        ...(contribution.capabilities.activation ? { activation: contribution.capabilities.activation } : {}),
      },
    }
  })
}

export function compilePromptDataModel(input: {
  skeleton: CompositionSkeleton
  sourceNodes: SourceNode[]
  fragments?: PromptFragment[]
  contributions?: PromptContribution[]
  orderProfile: ProjectionOrderProfile
  skeletonPatch?: CompositionSkeletonPatch
  currentInput?: string
  activationFacts?: ActivationFacts
}): CompiledPrompt {
  const skeleton = applyCompositionSkeletonPatch(input.skeleton, input.skeletonPatch ?? input.orderProfile.skeletonPatch)
  const fragments = [
    ...(input.fragments ?? []),
    ...materializePromptFragments(input.contributions ?? []),
  ]
  const zonesById = new Map(skeleton.zones.map(item => [item.id, item]))
  const sourceNodesById = new Map(input.sourceNodes.map(node => [node.id, node]))
  const activationByFragmentId = new Map(fragments.map(fragment => [
    fragment.id,
    evaluatePromptActivation({
      activation: fragment.projection.activation,
      currentInput: input.currentInput,
      facts: input.activationFacts,
    }),
  ]))
  const activeFragmentIds = new Set(
    [...activationByFragmentId.entries()]
      .filter(([, evaluation]) => evaluation.active)
      .map(([fragmentId]) => fragmentId),
  )
  const compiledZones = new Map<string, CompiledZone>()

  for (const fragment of fragments) {
    if (!activeFragmentIds.has(fragment.id)) continue

    const zoneNode = zonesById.get(fragment.projection.zoneId)
    if (!zoneNode) throw new Error(`Unknown zone: ${fragment.projection.zoneId}`)
    if (zoneNode.accepts && !zoneNode.accepts.includes(fragment.source.kind)) {
      throw new Error(`Zone ${zoneNode.id} does not accept ${fragment.source.kind}`)
    }

    const compiledZone = compiledZones.get(zoneNode.id) ?? {
      zoneId: zoneNode.id,
      displayName: zoneNode.displayName,
      slots: [],
    }
    const slotKey = materializeSlotKey(fragment)
    const slot = compiledZone.slots.find(item => item.slotKey === slotKey) ?? {
      slotKey,
      fragments: [],
      orderSource: 'sourceTreeFallback' as const,
    }

    slot.fragments.push(fragment)
    if (!compiledZone.slots.includes(slot)) compiledZone.slots.push(slot)
    compiledZones.set(zoneNode.id, compiledZone)
  }

  const sortedZones = [...compiledZones.values()]
    .map(compiledZone => sortCompiledZone(compiledZone, input.orderProfile, sourceNodesById))
    .sort((left, right) => {
      const leftZone = zonesById.get(left.zoneId)
      const rightZone = zonesById.get(right.zoneId)
      return (leftZone?.orderIndex ?? 0) - (rightZone?.orderIndex ?? 0)
    })

  return {
    zones: sortedZones,
    messages: sortedZones.map(compiledZone => {
      const renderZone = zonesById.get(compiledZone.zoneId)
      if (!renderZone) throw new Error(`Unknown compiled zone: ${compiledZone.zoneId}`)

      return {
        role: renderZone.renderHint.providerRoleHint,
        content: compiledZone.slots
          .flatMap(slot => slot.fragments)
          .map(fragment => fragment.content)
          .join('\n\n'),
      }
    }),
    editorProjection: {
      sourceRows: fragments.map(fragment => ({
        active: activeFragmentIds.has(fragment.id),
        activationReason: activationByFragmentId.get(fragment.id)?.reason ?? 'activation: unknown',
        fragmentId: fragment.id,
        sourceNodeId: fragment.source.sourceNodeId,
        sourcePath: readSourcePath(sourceNodesById, fragment.source.sourceNodeId),
        zoneId: fragment.projection.zoneId,
        slotKey: materializeSlotKey(fragment),
      })),
      promptRows: sortedZones.flatMap(compiledZone => compiledZone.slots.map(slot => ({
        zoneId: compiledZone.zoneId,
        slotKey: slot.slotKey,
        fragmentIds: slot.fragments.map(fragment => fragment.id),
        orderSource: slot.orderSource,
      }))),
    },
  }
}

function sortCompiledZone(zone: CompiledZone, profile: ProjectionOrderProfile, sourceNodesById: Map<string, SourceNode>): CompiledZone {
  return {
    ...zone,
    slots: [...zone.slots]
      .map(slot => ({
        ...slot,
        fragments: [...slot.fragments].sort((left, right) => compareFragmentOrder(sourceNodesById, left, right)),
        orderSource: readOrderSource(profile, zone, slot),
      }))
      .sort((left, right) => compareSlotOrder(profile, sourceNodesById, zone, left, right)),
  }
}

function readOrderSource(profile: ProjectionOrderProfile, zone: CompiledZone, slot: CompiledSlot): CompiledSlot['orderSource'] {
  if (readSlotRank(profile, zone, slot)) return 'rank'
  if (slot.fragments.some(fragment => fragment.projection.slotOrderHint !== undefined)) return 'slotOrderHint'
  return 'sourceTreeFallback'
}

function compareSlotOrder(
  profile: ProjectionOrderProfile,
  sourceNodesById: Map<string, SourceNode>,
  zone: CompiledZone,
  left: CompiledSlot,
  right: CompiledSlot,
): number {
  const leftRank = readSlotRank(profile, zone, left)
  const rightRank = readSlotRank(profile, zone, right)
  if (leftRank || rightRank) return compareText(leftRank ?? 'zzzz', rightRank ?? 'zzzz')

  const leftHint = Math.min(...left.fragments.map(fragment => fragment.projection.slotOrderHint ?? Number.POSITIVE_INFINITY))
  const rightHint = Math.min(...right.fragments.map(fragment => fragment.projection.slotOrderHint ?? Number.POSITIVE_INFINITY))
  if (leftHint !== rightHint) return leftHint - rightHint

  return comparePath(readSourceOrderPath(sourceNodesById, left.fragments[0]?.source.sourceNodeId), readSourceOrderPath(sourceNodesById, right.fragments[0]?.source.sourceNodeId))
    || compareText(left.slotKey, right.slotKey)
}

function compareFragmentOrder(sourceNodesById: Map<string, SourceNode>, left: PromptFragment, right: PromptFragment): number {
  const leftHint = left.projection.entryOrderHint ?? Number.POSITIVE_INFINITY
  const rightHint = right.projection.entryOrderHint ?? Number.POSITIVE_INFINITY
  if (leftHint !== rightHint) return leftHint - rightHint

  return comparePath(readSourceOrderPath(sourceNodesById, left.source.sourceNodeId), readSourceOrderPath(sourceNodesById, right.source.sourceNodeId))
    || compareText(left.id, right.id)
}

function readSlotRank(profile: ProjectionOrderProfile, zone: CompiledZone, slot: CompiledSlot): string | undefined {
  return profile.slotRanks.find(rank => (
    rank.slotKey === slot.slotKey
    && rank.zoneId === zone.zoneId
  ))?.rankKey
}

export function materializeSlotKey(fragment: PromptFragment): string {
  if (fragment.projection.joinSlotKey) return fragment.projection.joinSlotKey
  const sourceSlotKey = fragment.projection.sourceSlotKey ?? fragment.source.sourceId
  return `${kindToSlotPrefix(fragment.source.kind)}:${sourceSlotKey}@${fragment.projection.zoneId}`
}

function readSourcePath(sourceNodesById: Map<string, SourceNode>, nodeId: string): string {
  const names: string[] = []
  let cursor: string | null = nodeId

  while (cursor) {
    const node = sourceNodesById.get(cursor)
    if (!node) throw new Error(`Source node not found: ${cursor}`)
    names.push(node.displayName)
    cursor = node.parentId
  }

  return `/${names.reverse().join('/')}`
}

function readSourceOrderPath(sourceNodesById: Map<string, SourceNode>, nodeId: string | undefined): number[] {
  if (!nodeId) return []
  const path: number[] = []
  let cursor: string | null = nodeId

  while (cursor) {
    const node = sourceNodesById.get(cursor)
    if (!node) throw new Error(`Source node not found: ${cursor}`)
    path.push(node.orderIndex)
    cursor = node.parentId
  }

  return path.reverse()
}

function zone(
  id: string,
  displayName: string,
  band: ZoneNode['band'],
  orderIndex: number,
  providerRoleHint: PromptProviderRole,
  accepts: PromptSourceKind[],
): ZoneNode {
  return {
    id,
    parentId: 'zone.root',
    displayName,
    band,
    orderIndex,
    accepts,
    renderHint: {
      providerRoleHint,
      wrapper: 'section',
    },
  }
}

function mergeByKey<T>(baseItems: T[], patchItems: T[], readKey: (item: T) => string): T[] {
  const itemsByKey = new Map(baseItems.map(item => [readKey(item), item]))

  for (const item of patchItems) {
    const key = readKey(item)
    if (!itemsByKey.has(key)) itemsByKey.set(key, item)
  }

  return [...itemsByKey.values()]
}

function comparePath(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right)
}

function kindToSlotPrefix(kind: PromptSourceKind): string {
  if (kind === 'settingLayer') return 'setting-layer'
  if (kind === 'narrativeChat') return 'narrative-chat'
  return kind
}
