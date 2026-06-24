import { evaluatePromptActivation, type ActivationFacts, type PromptActivation } from './prompt-activation.js'

export type PromptAnchor = 'before' | 'inside' | 'after'
export type PromptProviderRole = 'system' | 'assistant' | 'user'
export type PromptSourceKind = 'preset' | 'settingLayer' | 'narrativeChat' | 'runtime'
export type PromptLifecycle = 'always' | 'conditional' | 'fresh'

export type PromptContentCapability = {
  kind: 'text'
}

export type PromptProjectionCapability = {
  injectionGroupKey: string
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
  injectionGroups: InjectionGroup[]
  fallbackZoneId: string
}

export type CompositionSkeletonPatch = {
  zones?: ZoneNode[]
  injectionGroups?: InjectionGroup[]
  fallbackZoneId?: string
}

export type ZoneNode = {
  id: string
  parentId: string | null
  key: string
  displayName: string
  band: 'stable-prefix' | 'narrative' | 'lower-context' | 'current-turn' | 'fresh-tail'
  orderIndex: number
  anchors: PromptAnchor[]
  renderHint: {
    providerRoleHint: PromptProviderRole
    wrapper: 'section' | 'message'
  }
}

export type InjectionGroup = {
  key: string
  displayName: string
  targetZoneKey: string
  anchor: PromptAnchor
  accepts: PromptSourceKind[]
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
    injectionGroupKey: string
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
    injectionGroupKey: string
    anchor?: PromptAnchor
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
  zoneKey: string
  displayName: string
  anchor: PromptAnchor
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
    injectionGroupKey: string
    slotKey: string
  }>
  promptRows: Array<{
    zoneKey: string
    anchor: PromptAnchor
    slotKey: string
    fragmentIds: string[]
    orderSource: CompiledSlot['orderSource']
  }>
}

export const defaultCompositionSkeleton: CompositionSkeleton = {
  id: 'skeleton.airp-default',
  rootZoneId: 'zone.root',
  fallbackZoneId: 'zone.lower-context',
  zones: [
    zone('zone.stable-prefix', 'zone.root', 'stable-prefix', 'Stable Prefix', 'stable-prefix', 10, 'system'),
    zone('zone.narrative-context', 'zone.root', 'narrative-context', 'Narrative Context', 'narrative', 20, 'assistant'),
    zone('zone.lower-context', 'zone.root', 'lower-context', 'Lower Context', 'lower-context', 30, 'system'),
    zone('zone.current-turn', 'zone.root', 'current-turn', 'Current Turn', 'current-turn', 40, 'user'),
    zone('zone.fresh-tail', 'zone.root', 'fresh-tail', 'Fresh Tail', 'fresh-tail', 50, 'system'),
  ],
  injectionGroups: [
    group('preset.system', 'Preset System', 'stable-prefix', 'inside', ['preset', 'runtime']),
    group('setting.stable', 'Stable Setting', 'stable-prefix', 'inside', ['settingLayer']),
    group('setting.lower', 'Lower Context Setting', 'lower-context', 'inside', ['settingLayer']),
    group('chat.history', 'Narrative History', 'narrative-context', 'inside', ['narrativeChat']),
    group('chat.before', 'Before Current Chat', 'current-turn', 'before', ['settingLayer', 'preset', 'runtime']),
    group('chat.inside', 'Current Chat', 'current-turn', 'inside', ['narrativeChat', 'runtime']),
    group('chat.after', 'After Current Chat', 'current-turn', 'after', ['settingLayer', 'preset', 'runtime']),
    group('fresh.tail', 'Fresh Tail', 'fresh-tail', 'inside', ['preset', 'settingLayer', 'runtime']),
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
    zones: mergeByKey(skeleton.zones, patch.zones ?? [], zone => zone.key),
    injectionGroups: mergeByKey(skeleton.injectionGroups, patch.injectionGroups ?? [], group => group.key),
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
        injectionGroupKey: projection.injectionGroupKey,
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
  const groupsByKey = new Map(skeleton.injectionGroups.map(group => [group.key, group]))
  const zonesByKey = new Map(skeleton.zones.map(item => [item.key, item]))
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

    const group = groupsByKey.get(fragment.projection.injectionGroupKey)
    if (!group) throw new Error(`Unknown injection group: ${fragment.projection.injectionGroupKey}`)
    if (!group.accepts.includes(fragment.source.kind)) {
      throw new Error(`Injection group ${group.key} does not accept ${fragment.source.kind}`)
    }

    const zoneNode = zonesByKey.get(group.targetZoneKey)
    if (!zoneNode) throw new Error(`Unknown zone: ${group.targetZoneKey}`)

    const compiledZoneKey = `${zoneNode.key}:${group.anchor}`
    const compiledZone = compiledZones.get(compiledZoneKey) ?? {
      zoneKey: zoneNode.key,
      displayName: zoneNode.displayName,
      anchor: group.anchor,
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
    compiledZones.set(compiledZoneKey, compiledZone)
  }

  const sortedZones = [...compiledZones.values()]
    .map(compiledZone => sortCompiledZone(compiledZone, input.orderProfile, sourceNodesById))
    .sort((left, right) => {
      const leftZone = zonesByKey.get(left.zoneKey)
      const rightZone = zonesByKey.get(right.zoneKey)
      return (leftZone?.orderIndex ?? 0) - (rightZone?.orderIndex ?? 0)
        || anchorOrder(left.anchor) - anchorOrder(right.anchor)
    })

  return {
    zones: sortedZones,
    messages: sortedZones.map(compiledZone => {
      const renderZone = zonesByKey.get(compiledZone.zoneKey)
      if (!renderZone) throw new Error(`Unknown compiled zone: ${compiledZone.zoneKey}`)

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
        injectionGroupKey: fragment.projection.injectionGroupKey,
        slotKey: materializeSlotKey(fragment),
      })),
      promptRows: sortedZones.flatMap(compiledZone => compiledZone.slots.map(slot => ({
        zoneKey: compiledZone.zoneKey,
        anchor: compiledZone.anchor,
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
    && (!rank.anchor || rank.anchor === zone.anchor)
    && slot.fragments.some(fragment => fragment.projection.injectionGroupKey === rank.injectionGroupKey)
  ))?.rankKey
}

export function materializeSlotKey(fragment: PromptFragment): string {
  if (fragment.projection.joinSlotKey) return fragment.projection.joinSlotKey
  const sourceSlotKey = fragment.projection.sourceSlotKey ?? fragment.source.sourceId
  return `${kindToSlotPrefix(fragment.source.kind)}:${sourceSlotKey}@${fragment.projection.injectionGroupKey}`
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
  parentId: string,
  key: ZoneNode['key'],
  displayName: string,
  band: ZoneNode['band'],
  orderIndex: number,
  providerRoleHint: PromptProviderRole,
): ZoneNode {
  return {
    id,
    parentId,
    key,
    displayName,
    band,
    orderIndex,
    anchors: ['before', 'inside', 'after'],
    renderHint: {
      providerRoleHint,
      wrapper: 'section',
    },
  }
}

function group(key: string, displayName: string, targetZoneKey: string, anchor: PromptAnchor, accepts: PromptSourceKind[]): InjectionGroup {
  return { key, displayName, targetZoneKey, anchor, accepts }
}

function mergeByKey<T>(baseItems: T[], patchItems: T[], readKey: (item: T) => string): T[] {
  const itemsByKey = new Map(baseItems.map(item => [readKey(item), item]))

  for (const item of patchItems) {
    const key = readKey(item)
    if (!itemsByKey.has(key)) itemsByKey.set(key, item)
  }

  return [...itemsByKey.values()]
}

function anchorOrder(anchor: PromptAnchor): number {
  if (anchor === 'before') return 0
  if (anchor === 'inside') return 1
  return 2
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
