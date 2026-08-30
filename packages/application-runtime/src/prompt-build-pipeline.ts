import {
  runPasses,
  type Fragment,
  type Pass,
  type Trace,
} from '@loom/core'
import { evaluatePromptActivation, type ActivationFacts } from './prompt-activation.js'
import {
  applyCompositionSkeletonPatch,
  compileMessageBlockPrompt,
  compilePromptDataModel,
  defaultCompositionSkeleton,
  materializeSlotKey,
  type CompiledPrompt,
  type CompiledSlot,
  type CompiledZone,
  type CompositionSkeleton,
  type CompositionSkeletonPatch,
  type PromptCompositionCapabilities,
  type PromptContribution,
  type PromptFragment,
  type PromptProviderRole,
  type ProjectionOrderProfile,
  type SourceNode,
} from './prompt-builder.js'

type PromptBuildSourceMeta = {
  promptBuild: {
    phase: 'source'
    contribution: PromptContribution
  }
}

type PromptBuildDerivedMeta = {
  promptBuild:
    | {
        phase: 'composition'
        fragment: PromptFragment
        active: boolean
        activationReason: string
      }
    | {
        phase: 'message'
        fragment: PromptFragment
        active: boolean
        activationReason: string
        role?: PromptProviderRole
      }
}

export type PromptBuildCoreMeta = PromptBuildSourceMeta | PromptBuildDerivedMeta

type MaterializeParams = {
  skeleton: CompositionSkeleton
  currentInput?: string
  activationFacts?: ActivationFacts
}

type OrderParams = {
  skeleton: CompositionSkeleton
  sourceNodes: SourceNode[]
  orderProfile: ProjectionOrderProfile
}

type EmitParams = {
  skeleton: CompositionSkeleton
  sourceNodes: SourceNode[]
  orderProfile: ProjectionOrderProfile
}

export type PromptBuildTrace = {
  version: 'core-compact-1'
  status: 'ok' | 'error'
  buildId?: string
  runId?: string
  agentSessionId?: string
  timelineId?: string
  branchId?: string
  variables?: import('./variables.js').VariableRenderTrace
  initialFragmentCount: number
  finalFragmentCount: number
  messageFragmentCount: number
  diagnostics: Array<{
    severity: string
    code: string
    pass: string
    fragmentId?: string
    relatedFragmentIds?: string[]
  }>
  executions: Array<{
    passName: string
    passIndex: number
    durationMs: number
    mutationCount: number
    mutations: Array<{
      op: string
      fragmentId: string
      fromIndex?: number
      toIndex?: number
    }>
    diagnostics: Array<{
      severity: string
      code: string
      fragmentId?: string
    }>
  }>
}

export type PromptBuildPipelineInput = {
  skeleton?: CompositionSkeleton
  skeletonPatch?: CompositionSkeletonPatch
  sourceNodes: SourceNode[]
  fragments?: PromptFragment[]
  contributions?: PromptContribution[]
  orderProfile: ProjectionOrderProfile
  currentInput?: string
  activationFacts?: ActivationFacts
  buildId?: string
  runId?: string
  agentSessionId?: string
  timelineId?: string
  branchId?: string
}

function sourceContribution(fragment: PromptFragment): PromptContribution {
  const capabilities: PromptCompositionCapabilities = {
    projection: {
      zoneId: fragment.projection.zoneId,
      ...(fragment.projection.bindingId ? { bindingId: fragment.projection.bindingId } : {}),
      ...(fragment.projection.sourceSlotKey ? { sourceSlotKey: fragment.projection.sourceSlotKey } : {}),
      ...(fragment.projection.joinSlotKey ? { joinSlotKey: fragment.projection.joinSlotKey } : {}),
      ...(fragment.projection.slotOrderHint !== undefined ? { slotOrderHint: fragment.projection.slotOrderHint } : {}),
      ...(fragment.projection.entryOrderHint !== undefined ? { entryOrderHint: fragment.projection.entryOrderHint } : {}),
    },
    lifecycle: { lifecycle: fragment.projection.lifecycle },
    ...(fragment.projection.activation ? { activation: fragment.projection.activation } : {}),
    ...(fragment.projection.render ? { render: fragment.projection.render } : {}),
  }
  return {
    id: fragment.id,
    sourceRef: fragment.source,
    content: fragment.content,
    capabilities,
  }
}

function readMeta(fragment: Fragment<PromptBuildCoreMeta>): PromptBuildCoreMeta['promptBuild'] | undefined {
  return fragment.meta?.promptBuild
}

function readSource(fragment: Fragment<PromptBuildCoreMeta>): PromptBuildSourceMeta['promptBuild'] | undefined {
  const meta = readMeta(fragment)
  return meta?.phase === 'source' ? meta : undefined
}

function readDerived(fragment: Fragment<PromptBuildCoreMeta>): PromptBuildDerivedMeta['promptBuild'] | undefined {
  const meta = readMeta(fragment)
  return meta && meta.phase !== 'source' ? meta : undefined
}

function materializePass(
  fragments: readonly Fragment<PromptBuildCoreMeta>[],
  params: MaterializeParams,
): readonly Fragment<PromptBuildCoreMeta>[] {
  const zonesById = new Map(params.skeleton.zones.map(zone => [zone.id, zone]))
  const derived: Fragment<PromptBuildCoreMeta>[] = []

  for (const fragment of fragments) {
    const source = readSource(fragment)
    if (!source) continue
    const contribution = source.contribution
    const projection = contribution.capabilities.projection
    if (!projection) throw new Error(`Prompt contribution missing projection capability: ${contribution.id}`)

    const activation = contribution.capabilities.activation
    const evaluation = evaluatePromptActivation({
      activation,
      currentInput: params.currentInput,
      facts: params.activationFacts,
    })
    const zone = zonesById.get(projection.zoneId)
    if (evaluation.active) {
      if (!zone) throw new Error(`Unknown zone: ${projection.zoneId}`)
      if (zone.accepts && !zone.accepts.includes(contribution.sourceRef.kind)) {
        throw new Error(`Zone ${zone.id} does not accept ${contribution.sourceRef.kind}`)
      }
    }

    const promptFragment: PromptFragment = {
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
        ...(activation ? { activation } : {}),
        ...(contribution.capabilities.render ? { render: contribution.capabilities.render } : {}),
      },
    }

    derived.push({
      id: `prompt.composition:${contribution.id}`,
      content: contribution.content,
      meta: {
        promptBuild: {
          phase: 'composition',
          fragment: promptFragment,
          active: evaluation.active,
          activationReason: evaluation.reason,
        },
      },
    })
  }

  return [...fragments, ...derived]
}

function orderPass(
  fragments: readonly Fragment<PromptBuildCoreMeta>[],
  params: OrderParams,
): readonly Fragment<PromptBuildCoreMeta>[] {
  const source = fragments.filter(fragment => Boolean(readSource(fragment)))
  const rest = fragments.filter(fragment => !readSource(fragment))
  const zonesById = new Map(params.skeleton.zones.map(zone => [zone.id, zone]))
  const sourceNodesById = new Map(params.sourceNodes.map(node => [node.id, node]))
  return [
    ...source,
    ...rest.sort((left, right) => compareDerivedFragments(left, right, params, zonesById, sourceNodesById)),
  ]
}

function compareDerivedFragments(
  left: Fragment<PromptBuildCoreMeta>,
  right: Fragment<PromptBuildCoreMeta>,
  params: OrderParams,
  zonesById: Map<string, CompositionSkeleton['zones'][number]>,
  sourceNodesById: Map<string, SourceNode>,
): number {
  const leftMeta = readDerived(left)
  const rightMeta = readDerived(right)
  if (!leftMeta || !rightMeta) return 0
  const leftFragment = leftMeta.fragment
  const rightFragment = rightMeta.fragment
  const zoneOrder = (zonesById.get(leftFragment.projection.zoneId)?.orderIndex ?? 0)
    - (zonesById.get(rightFragment.projection.zoneId)?.orderIndex ?? 0)
  if (zoneOrder !== 0) return zoneOrder

  const leftSlot = materializeSlotKey(leftFragment)
  const rightSlot = materializeSlotKey(rightFragment)
  const leftRank = readSlotRank(params.orderProfile, leftFragment.projection.zoneId, leftSlot)
  const rightRank = readSlotRank(params.orderProfile, rightFragment.projection.zoneId, rightSlot)
  if (leftRank || rightRank) {
    const rankOrder = (leftRank ?? 'zzzz').localeCompare(rightRank ?? 'zzzz')
    if (rankOrder !== 0) return rankOrder
  }

  const slotHint = (leftFragment.projection.slotOrderHint ?? Number.POSITIVE_INFINITY)
    - (rightFragment.projection.slotOrderHint ?? Number.POSITIVE_INFINITY)
  if (slotHint !== 0) return slotHint

  const sourcePathOrder = comparePath(
    readSourceOrderPath(sourceNodesById, leftFragment.source.sourceNodeId),
    readSourceOrderPath(sourceNodesById, rightFragment.source.sourceNodeId),
  )
  if (sourcePathOrder !== 0) return sourcePathOrder

  const entryOrder = (leftFragment.projection.entryOrderHint ?? Number.POSITIVE_INFINITY)
    - (rightFragment.projection.entryOrderHint ?? Number.POSITIVE_INFINITY)
  if (entryOrder !== 0) return entryOrder
  return leftFragment.id.localeCompare(rightFragment.id)
}

function readSlotRank(profile: ProjectionOrderProfile, zoneId: string, slotKey: string): string | undefined {
  return profile.slotRanks.find(rank => rank.zoneId === zoneId && rank.slotKey === slotKey)?.rankKey
}

function emitPass(
  fragments: readonly Fragment<PromptBuildCoreMeta>[],
  params: EmitParams,
): readonly Fragment<PromptBuildCoreMeta>[] {
  if (params.skeleton.items.some(item => item.kind === 'message')) {
    const composition = fragments
      .map(readDerived)
      .filter((item): item is Extract<PromptBuildDerivedMeta['promptBuild'], { phase: 'composition' }> => item?.phase === 'composition')
    const compiled = compileMessageBlockPrompt({
      skeleton: params.skeleton,
      fragments: composition.map(item => item.fragment),
      sourceNodesById: new Map(params.sourceNodes.map(node => [node.id, node])),
      orderProfile: params.orderProfile,
      activationByFragmentId: new Map(composition.map(item => [item.fragment.id, {
        active: item.active,
        reason: item.activationReason,
      }])),
      activeFragmentIds: new Set(composition.filter(item => item.active).map(item => item.fragment.id)),
    })
    const messages: Fragment<PromptBuildCoreMeta>[] = compiled.messageBlocks.map((message, index) => {
      const firstFragment = composition.find(item => item.fragment.id === message.fragmentIds[0])
      if (!firstFragment) throw new Error(`MessageBlock has no source fragments: ${index}`)
      return {
        id: `prompt.message:${message.messageBlockId ?? 'native'}:${index}`,
        content: message.content,
        meta: {
          promptBuild: {
            phase: 'message',
            fragment: firstFragment.fragment,
            active: true,
            activationReason: 'message block compiled',
            role: message.role,
          },
        },
      }
    })
    return [...fragments, ...messages]
  }
  const zonesById = new Map(params.skeleton.zones.map(zone => [zone.id, zone]))
  const messages: Fragment<PromptBuildCoreMeta>[] = []
  for (const fragment of fragments) {
    const derived = readDerived(fragment)
    if (!derived || derived.phase !== 'composition' || !derived.active) continue
    const zone = zonesById.get(derived.fragment.projection.zoneId)
    if (!zone) throw new Error(`Unknown zone: ${derived.fragment.projection.zoneId}`)
    messages.push({
      id: `prompt.message:${derived.fragment.id}`,
      content: derived.fragment.content,
      meta: {
        promptBuild: {
          phase: 'message',
          fragment: derived.fragment,
          active: true,
          activationReason: derived.activationReason,
          role: derived.fragment.projection.render?.roleHint ?? zone.renderHint?.providerRoleHint ?? 'system',
        },
      },
    })
  }
  return [...fragments, ...messages]
}

function createSourceFragments(input: PromptBuildPipelineInput): Fragment<PromptBuildCoreMeta>[] {
  const contributions = [
    ...(input.fragments ?? []).map(sourceContribution),
    ...(input.contributions ?? []),
  ]
  return contributions.map(contribution => ({
    id: `prompt.source:${contribution.id}`,
    content: contribution.content,
    meta: {
      promptBuild: {
        phase: 'source',
        contribution,
      },
    },
  }))
}

function readSourceOrderPath(sourceNodesById: Map<string, SourceNode>, nodeId: string): number[] {
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

function comparePath(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

function compactTrace(
  trace: Trace<PromptBuildCoreMeta>,
  input: PromptBuildPipelineInput,
  messageFragmentCount: number,
): PromptBuildTrace {
  return {
    version: 'core-compact-1',
    status: trace.status,
    ...(input.buildId ? { buildId: input.buildId } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.agentSessionId ? { agentSessionId: input.agentSessionId } : {}),
    ...(input.timelineId ? { timelineId: input.timelineId } : {}),
    ...(input.branchId ? { branchId: input.branchId } : {}),
    initialFragmentCount: trace.initialFragments.length,
    finalFragmentCount: trace.finalFragments.length,
    messageFragmentCount,
    diagnostics: trace.diagnostics.map(diagnostic => ({
      severity: diagnostic.severity,
      code: diagnostic.code,
      pass: diagnostic.pass,
      ...(diagnostic.fragmentId ? { fragmentId: diagnostic.fragmentId } : {}),
      ...(diagnostic.relatedFragmentIds ? { relatedFragmentIds: [...diagnostic.relatedFragmentIds] } : {}),
    })),
    executions: trace.executions.map(execution => ({
      passName: execution.passName,
      passIndex: execution.passIndex,
      durationMs: execution.durationMs,
      mutationCount: execution.mutations.length,
      mutations: execution.mutations.map(mutation => ({
        op: mutation.op,
        fragmentId: mutation.fragmentId,
        ...('fromIndex' in mutation ? { fromIndex: mutation.fromIndex } : {}),
        ...('toIndex' in mutation ? { toIndex: mutation.toIndex } : {}),
      })),
      diagnostics: execution.diagnostics.map(diagnostic => ({
        severity: diagnostic.severity,
        code: diagnostic.code,
        ...(diagnostic.fragmentId ? { fragmentId: diagnostic.fragmentId } : {}),
      })),
    })),
  }
}

function readOrderSource(
  profile: ProjectionOrderProfile,
  fragment: PromptFragment,
  slotKey: string,
): CompiledSlot['orderSource'] {
  if (readSlotRank(profile, fragment.projection.zoneId, slotKey)) return 'rank'
  if (fragment.projection.slotOrderHint !== undefined) return 'slotOrderHint'
  return 'sourceTreeFallback'
}

function buildCompiledPrompt(
  input: PromptBuildPipelineInput,
  result: ReturnType<typeof runPasses<PromptBuildCoreMeta>>,
  skeleton: CompositionSkeleton,
): { projection: CompiledPrompt; trace: PromptBuildTrace } {
  if (result.status === 'error') throw new Error(result.error?.message ?? 'PromptBuild Core pipeline failed')

  const sourceNodesById = new Map(input.sourceNodes.map(node => [node.id, node]))
  const derived = result.fragments
    .map(readDerived)
    .filter((item): item is PromptBuildDerivedMeta['promptBuild'] => Boolean(item))
  const composition = derived.filter((item): item is Extract<PromptBuildDerivedMeta['promptBuild'], { phase: 'composition' }> => item.phase === 'composition')
  const messages = derived.filter((item): item is Extract<PromptBuildDerivedMeta['promptBuild'], { phase: 'message' }> => item.phase === 'message')
  if (skeleton.items.some(item => item.kind === 'message')) {
    const projection = compilePromptDataModel({
      skeleton,
      sourceNodes: input.sourceNodes,
      fragments: composition.map(item => item.fragment),
      orderProfile: input.orderProfile,
      currentInput: input.currentInput,
      activationFacts: input.activationFacts,
    })
    return {
      projection,
      trace: compactTrace(result.trace, input, projection.messageBlocks.length),
    }
  }
  const zonesById = new Map(skeleton.zones.map(zone => [zone.id, zone]))
  const compiledZones = new Map<string, CompiledZone>()

  for (const item of messages) {
    const zone = zonesById.get(item.fragment.projection.zoneId)
    if (!zone) throw new Error(`Unknown zone: ${item.fragment.projection.zoneId}`)
    const slotKey = materializeSlotKey(item.fragment)
    const compiledZone = compiledZones.get(zone.id) ?? {
      zoneId: zone.id,
      displayName: zone.displayName,
      slots: [],
    }
    const slot = compiledZone.slots.find(candidate => candidate.slotKey === slotKey) ?? {
      slotKey,
      fragments: [],
      orderSource: readOrderSource(input.orderProfile, item.fragment, slotKey),
    }
    slot.fragments.push(item.fragment)
    if (!compiledZone.slots.includes(slot)) compiledZone.slots.push(slot)
    compiledZones.set(zone.id, compiledZone)
  }

  const sortedZones = [...compiledZones.values()]
    .map(zone => ({ ...zone, slots: [...zone.slots] }))
    .sort((left, right) => (zonesById.get(left.zoneId)?.orderIndex ?? 0) - (zonesById.get(right.zoneId)?.orderIndex ?? 0))
  const emittedMessages: Array<{
    role: PromptProviderRole
    content: string
    zoneId: string
    slotKey: string
    mergeable: boolean
  }> = []
  for (const item of messages) {
    const zoneId = item.fragment.projection.zoneId
    const slotKey = materializeSlotKey(item.fragment)
    const role = item.role ?? zonesById.get(zoneId)?.renderHint?.providerRoleHint ?? 'system'
    const mergeable = item.fragment.projection.render?.wrapper !== 'message'
    const previous = emittedMessages.at(-1)
    if (
      mergeable
      && previous?.mergeable
      && previous.role === role
      && previous.zoneId === zoneId
      && previous.slotKey === slotKey
    ) {
      previous.content = `${previous.content}\n\n${item.fragment.content}`
    } else {
      emittedMessages.push({ role, content: item.fragment.content, zoneId, slotKey, mergeable })
    }
  }
  const projection: CompiledPrompt = {
    zones: sortedZones,
    messages: emittedMessages.map(({ role, content }) => ({ role, content })),
    messageBlocks: emittedMessages.map(({ role, content }) => ({ role, content, fragmentIds: [] })),
    editorProjection: {
      sourceRows: composition.map(item => ({
        active: item.active,
        activationReason: item.activationReason,
        fragmentId: item.fragment.id,
        sourceNodeId: item.fragment.source.sourceNodeId,
        sourcePath: readSourcePath(sourceNodesById, item.fragment.source.sourceNodeId),
        zoneId: item.fragment.projection.zoneId,
        slotKey: materializeSlotKey(item.fragment),
      })),
      promptRows: sortedZones.flatMap(zone => zone.slots.map(slot => ({
        zoneId: zone.zoneId,
        slotKey: slot.slotKey,
        fragmentIds: slot.fragments.map(fragment => fragment.id),
        orderSource: slot.orderSource,
      }))),
    },
  }
  return {
    projection,
    trace: compactTrace(result.trace, input, messages.length),
  }
}

export function compilePromptWithCore(input: PromptBuildPipelineInput): {
  projection: CompiledPrompt
  trace: PromptBuildTrace
} {
  const skeleton = applyCompositionSkeletonPatch(
    input.skeleton ?? defaultCompositionSkeleton,
    input.skeletonPatch ?? input.orderProfile.skeletonPatch,
  )
  const passes: readonly Pass<PromptBuildCoreMeta>[] = [
    {
      name: 'prompt.materialize',
      run: fragments => materializePass(fragments, {
        skeleton,
        currentInput: input.currentInput,
        activationFacts: input.activationFacts,
      }),
    },
    {
      name: 'prompt.order',
      run: fragments => orderPass(fragments, {
        skeleton,
        sourceNodes: input.sourceNodes,
        orderProfile: input.orderProfile,
      }),
    },
    {
      name: 'prompt.emit',
      run: fragments => emitPass(fragments, {
        skeleton,
        sourceNodes: input.sourceNodes,
        orderProfile: input.orderProfile,
      }),
    },
  ]
  const result = runPasses({
    passes,
    fragments: createSourceFragments(input),
  })
  return buildCompiledPrompt(input, result, skeleton)
}
