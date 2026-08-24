import { evaluatePromptActivation, type ActivationFacts, type PromptActivation } from './prompt-activation.js'

export type PromptProviderRole = 'system' | 'developer' | 'assistant' | 'user'
export type PromptSourceKind = 'preset' | 'settingLayer' | 'narrativeChat' | 'narrativeHistory' | 'sessionHistory' | 'runtime'
export type PromptLifecycle = 'always' | 'conditional' | 'fresh'

export const promptZoneIds = {
  presetSystem: 'preset.system',
  tools: 'tools',
  settingStable: 'setting.stable',
  narrativeHistory: 'chat.history',
  sessionHistory: 'session.history',
  currentTurn: 'chat.inside',
  freshTail: 'fresh.tail',
} as const

export const promptSlotIds = {
  narrativeMain: `runtime:narrative.main@${promptZoneIds.narrativeHistory}`,
  sessionMain: `runtime:session.main@${promptZoneIds.sessionHistory}`,
  currentInput: `runtime:current.input@${promptZoneIds.currentTurn}`,
} as const

export const promptBindingIds = {
  narrativeHistory: 'runtime.narrativeHistory',
  sessionHistory: 'runtime.sessionHistory',
  currentInput: 'runtime.currentInput',
} as const

export type PromptContentCapability = {
  kind: 'text'
}

export type PromptProjectionCapability = {
  zoneId: string
  bindingId?: string
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
  // ponytail: legacy Zone-only shape remains readable while the Core pipeline migrates to items; remove after CompositionItem consumption is complete.
  zones: ZoneNode[]
  items: CompositionItem[]
  fallbackZoneId: string
}

export type CompositionSkeletonPatch = {
  zones?: ZoneNode[]
  items?: CompositionItem[]
  fallbackZoneId?: string
}

export type CompositionItemBase = {
  id: string
  orderIndex: number
  displayName: string
  activation?: PromptActivation
  renderHint?: {
    providerRoleHint?: PromptProviderRole
    wrapper?: 'section' | 'message' | 'inline'
  }
}

/**
 * A MessageBlock is a compiler instruction, not a semantic injection point.
 * Its children are ordered Context items which are rendered into one provider
 * message with the block role.
 */
export type MessageBlockNode = CompositionItemBase & {
  kind: 'message'
  role: PromptProviderRole
  items: MessageBlockItem[]
}

export type MessageBlockItem = ZoneNode | SlotNode | EntryNode

export type SlotNode = CompositionItemBase & {
  kind: 'slot'
  bindingId: string
  zoneId?: string
  messageMode?: 'context' | 'native'
  slotKey?: string
}

export type EntryNode = CompositionItemBase & {
  kind: 'entry'
  source:
    | { kind: 'preset'; nodeId: string }
    | { kind: 'binding'; bindingId: string }
}

export type CompositionItem = MessageBlockNode | ZoneNode | SlotNode | EntryNode

export type ZoneNode = {
  kind?: 'zone'
  id: string
  parentId: string | null
  displayName: string
  band: 'stable-prefix' | 'narrative' | 'lower-context' | 'current-turn' | 'fresh-tail'
  orderIndex: number
  accepts?: PromptSourceKind[]
  /** Legacy display/render hint. New MessageBlock compilation does not read it. */
  renderHint?: {
    providerRoleHint?: PromptProviderRole
    wrapper?: 'section' | 'message'
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
    bindingId?: string
    lifecycle: PromptLifecycle
    sourceSlotKey?: string
    joinSlotKey?: string
    slotOrderHint?: number
    entryOrderHint?: number
    activation?: PromptActivation
    render?: PromptRenderCapability
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
  messageBlocks: CompiledMessage[]
  editorProjection: EditorProjection
}

export type CompiledMessage = {
  role: PromptProviderRole
  content: string
  messageBlockId?: string
  fragmentIds: string[]
  native?: boolean
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
    zone(promptZoneIds.presetSystem, 'Preset System', 'stable-prefix', 10, ['preset', 'runtime']),
    zone(promptZoneIds.tools, 'Tools', 'stable-prefix', 15, ['runtime']),
    zone(promptZoneIds.settingStable, 'Stable Setting', 'stable-prefix', 20, ['settingLayer']),
    zone(promptZoneIds.narrativeHistory, 'Narrative History', 'narrative', 30, ['narrativeChat', 'narrativeHistory']),
    zone(promptZoneIds.sessionHistory, 'Session History', 'narrative', 35, ['sessionHistory']),
    zone('setting.lower', 'Lower Context Setting', 'lower-context', 40, ['settingLayer']),
    zone('chat.before', 'Before Current Chat', 'current-turn', 50, ['settingLayer', 'preset', 'runtime']),
    zone(promptZoneIds.currentTurn, 'Current Chat', 'current-turn', 60, ['narrativeChat', 'narrativeHistory', 'sessionHistory', 'runtime']),
    zone('chat.after', 'After Current Chat', 'current-turn', 70, ['settingLayer', 'preset', 'runtime']),
    zone(promptZoneIds.freshTail, 'Fresh Tail', 'fresh-tail', 80, ['preset', 'settingLayer', 'runtime']),
  ],
  items: [
    messageBlock('message.system', 'System', 'system', 10, [
      zone(promptZoneIds.presetSystem, 'Preset System', 'stable-prefix', 10, ['preset', 'runtime']),
      zone(promptZoneIds.tools, 'Tools', 'stable-prefix', 15, ['runtime']),
      zone(promptZoneIds.settingStable, 'Stable Setting', 'stable-prefix', 20, ['settingLayer']),
      zone('setting.lower', 'Lower Context Setting', 'lower-context', 40, ['settingLayer']),
    ]),
    messageBlock('message.developer', 'Developer', 'developer', 20, [
      zone(promptZoneIds.narrativeHistory, 'Narrative History', 'narrative', 30, ['narrativeChat', 'narrativeHistory']),
      {
        kind: 'slot',
        id: promptSlotIds.narrativeMain,
        orderIndex: 31,
        displayName: 'Narrative History Content',
        bindingId: promptBindingIds.narrativeHistory,
        zoneId: promptZoneIds.narrativeHistory,
        slotKey: promptSlotIds.narrativeMain,
        messageMode: 'context',
      },
    ]),
    {
      kind: 'slot',
      id: promptSlotIds.sessionMain,
      orderIndex: 30,
      displayName: 'Session History',
      bindingId: promptBindingIds.sessionHistory,
      zoneId: promptZoneIds.sessionHistory,
      slotKey: promptSlotIds.sessionMain,
      messageMode: 'native',
    },
    messageBlock('message.user', 'User', 'user', 40, [
      zone('chat.before', 'Before Current Chat', 'current-turn', 50, ['settingLayer', 'preset', 'runtime']),
      {
        kind: 'entry',
        id: promptSlotIds.currentInput,
        orderIndex: 60,
        displayName: 'Current User Input',
        source: { kind: 'binding', bindingId: promptBindingIds.currentInput },
      },
      zone('chat.after', 'After Current Chat', 'current-turn', 70, ['settingLayer', 'preset', 'runtime']),
    ]),
    messageBlock('message.fresh-tail', 'System', 'system', 50, [
      zone(promptZoneIds.freshTail, 'Fresh Tail', 'fresh-tail', 80, ['preset', 'settingLayer', 'runtime']),
    ]),
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

  const usesMessageBlocks = patch.items?.some(item => item.kind === 'message') ?? false

  return {
    ...skeleton,
    zones: mergeByKey(skeleton.zones, patch.zones ?? [], zone => zone.id),
    // Old Presets own a complete flat item list. Do not silently mix that
    // legacy list with the new default MessageBlock list.
    items: patch.items && !usesMessageBlocks
      ? patch.items
      : mergeByKey(skeleton.items, patch.items ?? [], item => item.id),
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
        ...(projection.bindingId ? { bindingId: projection.bindingId } : {}),
        lifecycle: contribution.capabilities.lifecycle?.lifecycle ?? 'always',
        ...(projection.sourceSlotKey ? { sourceSlotKey: projection.sourceSlotKey } : {}),
        ...(projection.joinSlotKey ? { joinSlotKey: projection.joinSlotKey } : {}),
        ...(projection.slotOrderHint !== undefined ? { slotOrderHint: projection.slotOrderHint } : {}),
        ...(projection.entryOrderHint !== undefined ? { entryOrderHint: projection.entryOrderHint } : {}),
        ...(contribution.capabilities.activation ? { activation: contribution.capabilities.activation } : {}),
        ...(contribution.capabilities.render ? { render: contribution.capabilities.render } : {}),
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
  if (hasMessageBlocks(skeleton)) {
    return compileMessageBlockPrompt({
      skeleton,
      fragments,
      sourceNodesById,
      orderProfile: input.orderProfile,
      activationByFragmentId,
      activeFragmentIds,
    })
  }
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
    messages: sortedZones.flatMap(compiledZone => {
      const renderZone = zonesById.get(compiledZone.zoneId)
      if (!renderZone) throw new Error(`Unknown compiled zone: ${compiledZone.zoneId}`)
      return emitCompiledMessages(compiledZone, renderZone.renderHint?.providerRoleHint ?? 'system')
    }),
    messageBlocks: sortedZones.flatMap(compiledZone => emitCompiledMessages(compiledZone, zonesById.get(compiledZone.zoneId)?.renderHint?.providerRoleHint ?? 'system').map(message => ({
      ...message,
      fragmentIds: compiledZone.slots.flatMap(slot => slot.fragments.map(fragment => fragment.id)),
    }))),
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

function emitCompiledMessages(
  zone: CompiledZone,
  fallbackRole: PromptProviderRole,
): Array<{ role: PromptProviderRole; content: string }> {
  const messages: Array<{ role: PromptProviderRole; content: string }> = []
  for (const fragment of zone.slots.flatMap(slot => slot.fragments)) {
    const role = fragment.projection.render?.roleHint ?? fallbackRole
    const wrapper = fragment.projection.render?.wrapper ?? 'section'
    const previous = messages.at(-1)
    if (wrapper !== 'message' && previous?.role === role) {
      previous.content = `${previous.content}\n\n${fragment.content}`
    } else {
      messages.push({ role, content: fragment.content })
    }
  }
  return messages
}

function hasMessageBlocks(skeleton: CompositionSkeleton): boolean {
  return skeleton.items.some(item => item.kind === 'message')
}

export function compileMessageBlockPrompt(input: {
  skeleton: CompositionSkeleton
  fragments: PromptFragment[]
  sourceNodesById: Map<string, SourceNode>
  orderProfile: ProjectionOrderProfile
  activationByFragmentId: Map<string, { active: boolean; reason: string }>
  activeFragmentIds: Set<string>
}): CompiledPrompt {
  const zonesById = new Map(input.skeleton.zones.map(zone => [zone.id, zone]))
  const blockLocations = new Map<string, MessageBlockNode>()
  const nativeSlots: SlotNode[] = []
  const blockItems = new Map<string, MessageBlockItem[]>()

  for (const item of input.skeleton.items) {
    if (item.kind === 'message') {
      blockItems.set(item.id, item.items)
      for (const child of item.items) {
        if (child.kind === 'zone') {
          zonesById.set(child.id, child)
          if (blockLocations.has(child.id)) throw new Error(`Zone belongs to multiple MessageBlocks: ${child.id}`)
          blockLocations.set(child.id, item)
        }
      }
    } else if (item.kind === 'slot' && item.messageMode === 'native') {
      nativeSlots.push(item)
    }
  }

  const activeFragments = input.fragments.filter(fragment => input.activeFragmentIds.has(fragment.id))
  for (const fragment of activeFragments) {
    const zone = zonesById.get(fragment.projection.zoneId)
    if (!zone) throw new Error(`Unknown zone: ${fragment.projection.zoneId}`)
    if (zone.accepts && !zone.accepts.includes(fragment.source.kind)) {
      throw new Error(`Zone ${zone.id} does not accept ${fragment.source.kind}`)
    }
    const mountedByMessageBlock = [...blockItems.values()].some(items => items.some(item => (
      (item.kind === 'zone' && item.id === zone.id)
      || (item.kind === 'slot' && item.zoneId === zone.id && matchesSlot(item, fragment))
      || (item.kind === 'entry' && matchesEntry(item, fragment))
    )))
    if (!mountedByMessageBlock && !nativeSlots.some(slot => slot.zoneId === zone.id && matchesSlot(slot, fragment))) {
      throw new Error(`Active Prompt contribution is not mounted through a MessageBlock or native Slot: ${fragment.id}`)
    }
  }

  const compiledZones = compileZones(activeFragments, zonesById, input.orderProfile, input.sourceNodesById)
  const claimed = new Set<string>()
  const messages: CompiledMessage[] = []

  const appendBlockItem = (block: MessageBlockNode, child: MessageBlockItem): void => {
    let candidates: PromptFragment[]
    let preservesCompiledOrder = false
    if (child.kind === 'zone') {
      const explicitChildren = blockItems.get(block.id) ?? []
      candidates = flattenZoneFragments(compiledZones.get(child.id)).filter(fragment => !explicitChildren.some(item => (
        (item.kind === 'slot' && matchesSlot(item, fragment))
        || (item.kind === 'entry' && matchesEntry(item, fragment))
      )))
      preservesCompiledOrder = true
    } else if (child.kind === 'slot') {
      candidates = activeFragments.filter(fragment => matchesSlot(child, fragment))
    } else if (child.kind === 'entry') {
      candidates = activeFragments.filter(fragment => matchesEntry(child, fragment))
    } else {
      candidates = []
    }
    const unclaimedCandidates = candidates.filter(fragment => !claimed.has(fragment.id))
    const fragments = preservesCompiledOrder
      ? unclaimedCandidates
      : unclaimedCandidates.sort((left, right) =>
          compareFragmentOrder(input.sourceNodesById, left, right),
        )
    if (fragments.length === 0) return
    fragments.forEach(fragment => claimed.add(fragment.id))
    const previous = messages.at(-1)
    if (previous?.messageBlockId === block.id) {
      previous.content = `${previous.content}\n\n${fragments.map(fragment => fragment.content).join('\n\n')}`
      previous.fragmentIds.push(...fragments.map(fragment => fragment.id))
    } else {
      messages.push({
        role: block.role,
        content: fragments.map(fragment => fragment.content).join('\n\n'),
        messageBlockId: block.id,
        fragmentIds: fragments.map(fragment => fragment.id),
      })
    }
  }

  const appendNativeSlot = (slot: SlotNode): void => {
    const fragments = activeFragments
      .filter(fragment => !claimed.has(fragment.id) && matchesSlot(slot, fragment))
      .sort((left, right) => compareFragmentOrder(input.sourceNodesById, left, right))
    for (const fragment of fragments) {
      claimed.add(fragment.id)
      const role = fragment.projection.render?.roleHint
      if (!role) throw new Error(`Native Slot contribution must provide a provider role: ${fragment.id}`)
      messages.push({ role, content: fragment.content, fragmentIds: [fragment.id], native: true })
    }
  }

  for (const item of [...input.skeleton.items].sort((left, right) => left.orderIndex - right.orderIndex)) {
    if (item.kind === 'message') {
      for (const child of blockItems.get(item.id) ?? []) appendBlockItem(item, child)
    } else if (item.kind === 'slot' && item.messageMode === 'native') {
      appendNativeSlot(item)
    }
  }

  const unclaimed = activeFragments.filter(fragment => !claimed.has(fragment.id))
  if (unclaimed.length > 0) {
    throw new Error(`Active Prompt contribution is not mounted: ${unclaimed.map(fragment => fragment.id).join(', ')}`)
  }

  const editorProjection = {
    sourceRows: input.fragments.map(fragment => ({
      active: input.activeFragmentIds.has(fragment.id),
      activationReason: input.activationByFragmentId.get(fragment.id)?.reason ?? 'activation: unknown',
      fragmentId: fragment.id,
      sourceNodeId: fragment.source.sourceNodeId,
      sourcePath: readSourcePath(input.sourceNodesById, fragment.source.sourceNodeId),
      zoneId: fragment.projection.zoneId,
      slotKey: materializeSlotKey(fragment),
    })),
    promptRows: [...compiledZones.values()].flatMap(zone => zone.slots.map(slot => ({
      zoneId: zone.zoneId,
      slotKey: slot.slotKey,
      fragmentIds: slot.fragments.map(fragment => fragment.id),
      orderSource: slot.orderSource,
    }))),
  }

  return {
    zones: [...compiledZones.values()],
    messages: messages.map(({ role, content }) => ({ role, content })),
    messageBlocks: messages,
    editorProjection,
  }
}

function compileZones(
  fragments: PromptFragment[],
  zonesById: Map<string, ZoneNode>,
  profile: ProjectionOrderProfile,
  sourceNodesById: Map<string, SourceNode>,
): Map<string, CompiledZone> {
  const compiled = new Map<string, CompiledZone>()
  for (const fragment of fragments) {
    const zone = zonesById.get(fragment.projection.zoneId)
    if (!zone) throw new Error(`Unknown zone: ${fragment.projection.zoneId}`)
    const compiledZone = compiled.get(zone.id) ?? { zoneId: zone.id, displayName: zone.displayName, slots: [] }
    const slotKey = materializeSlotKey(fragment)
    const slot = compiledZone.slots.find(candidate => candidate.slotKey === slotKey) ?? {
      slotKey,
      fragments: [],
      orderSource: 'sourceTreeFallback' as const,
    }
    slot.fragments.push(fragment)
    if (!compiledZone.slots.includes(slot)) compiledZone.slots.push(slot)
    compiled.set(zone.id, compiledZone)
  }
  return new Map(
    [...compiled.values()]
      .map(zone => sortCompiledZone(zone, profile, sourceNodesById))
      .sort((left, right) => (zonesById.get(left.zoneId)?.orderIndex ?? 0) - (zonesById.get(right.zoneId)?.orderIndex ?? 0))
      .map(zone => [zone.zoneId, zone]),
  )
}

function flattenZoneFragments(zone: CompiledZone | undefined): PromptFragment[] {
  return zone?.slots.flatMap(slot => slot.fragments) ?? []
}

function matchesSlot(slot: SlotNode, fragment: PromptFragment): boolean {
  if (slot.zoneId !== undefined && fragment.projection.zoneId !== slot.zoneId) return false
  return fragment.projection.bindingId === slot.bindingId
    || (slot.slotKey !== undefined && (fragment.projection.joinSlotKey === slot.slotKey || materializeSlotKey(fragment) === slot.slotKey))
}

function matchesEntry(entry: EntryNode, fragment: PromptFragment): boolean {
  if (entry.source.kind === 'binding') return fragment.projection.bindingId === entry.source.bindingId
  return fragment.source.kind === 'preset' && fragment.source.sourceNodeId === entry.source.nodeId
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
  accepts: PromptSourceKind[],
): ZoneNode {
  return {
    kind: 'zone',
    id,
    parentId: 'zone.root',
    displayName,
    band,
    orderIndex,
    accepts,
  }
}

function messageBlock(
  id: string,
  displayName: string,
  role: PromptProviderRole,
  orderIndex: number,
  items: MessageBlockItem[],
): MessageBlockNode {
  return {
    kind: 'message',
    id,
    orderIndex,
    displayName,
    role,
    items,
  }
}

function mergeByKey<T>(baseItems: T[], patchItems: T[], readKey: (item: T) => string): T[] {
  const itemsByKey = new Map(baseItems.map(item => [readKey(item), item]))

  for (const item of patchItems) {
    const key = readKey(item)
    itemsByKey.set(key, item)
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
