import { promptAnchorOutput, isPromptMessageSequence } from '@loom-studio/shared'
import type { ObservationBuild } from '../observability/types.js'
import { evaluatePromptActivation, type ActivationFacts } from './prompt-activation.js'
import type {
  CompiledMessage,
  CompiledPrompt,
  PromptContribution,
  PromptFragment,
  PromptProviderRole,
  SourceNode
} from './prompt-builder.js'

export type PromptBuildTrace = {
  observation?: ObservationBuild
  version: 'core-compact-1'
  status: 'ok' | 'error'
  buildId?: string
  runId?: string
  agentSessionId?: string
  timelineId?: string
  branchId?: string
  initialFragmentCount: number
  finalFragmentCount: number
  messageFragmentCount: number
  diagnostics: unknown[]
  executions: unknown[]
  variables?: Record<string, unknown>
  narrativeContext?: {
    sourceId: string
    version: string
    coveredThroughNodeId: string | null
    rawThroughNodeId: string | null
  }
}

export type PromptDataModel = {
  contributions: PromptContribution[]
  sourceNodes: SourceNode[]
  skeletonRootId?: string
  currentInput?: string
  activationFacts?: ActivationFacts
}

export function compilePromptDataModel(input: PromptDataModel, observation?: ObservationBuild): CompiledPrompt {
  if (input.contributions.some(entry => entry.capabilities.processorId))
    throw new Error('Authored Prompt processors require the asynchronous build path')
  return emitObservedPromptBlocks(planPromptBlocks(input, observation), input, observation)
}

/** Planning is synchronous; async language processors run over these ordered fragments. */
export function planPromptBlocks(input: PromptDataModel, observation?: ObservationBuild): PromptFragment[][] {
  const { contributions, sourceNodes, activationFacts } = input
  recordPromptSources(input, observation)
  const recordActivation = (id: string, result: { active: boolean; reason: string }) => captureBuildEvidence(() => {
    const source = observation?.sources?.find(source => source.id === id)
    if (source) Object.assign(source, result)
  })
  const disabledNodeIds = new Set(sourceNodes.filter(node => node.enabled === false).map(node => node.id))
  
  const activeContributions = contributions.filter(c => {
    const result = disabledNodeIds.has(c.sourceRef.sourceNodeId)
      ? { active: false, reason: 'author or ancestor disabled' }
      : evaluatePromptActivation({ activation: c.capabilities.activation, currentInput: input.currentInput, facts: activationFacts ?? {} })
    recordActivation(c.sourceRef.sourceNodeId, result)
    return result.active
  })
  
  const childrenByParent = new Map<string | null, SourceNode[]>()
  for (const node of sourceNodes) {
    const arr = childrenByParent.get(node.parentId) ?? []
    arr.push(node)
    childrenByParent.set(node.parentId, arr)
  }
  
  for (const arr of childrenByParent.values()) {
    arr.sort((a, b) => a.orderIndex - b.orderIndex)
  }

  if (input.skeletonRootId) {
    const root = sourceNodes.find(node => node.id === input.skeletonRootId)
    if (!root) throw new Error(`Prompt skeleton root not found: ${input.skeletonRootId}`)
    childrenByParent.set(null, [root])
  }
  const isActiveNode = (node: SourceNode) => {
    const result = node.enabled === false
      ? { active: false, reason: node.evidence?.disabledReason ?? 'author or ancestor disabled' }
      : evaluatePromptActivation({ activation: node.capabilities?.activation, currentInput: input.currentInput, facts: activationFacts ?? {} })
    recordActivation(node.id, result)
    return result.active
  }
  const skeletonNodes: SourceNode[] = []
  function collectSkeleton(parentId: string | null) {
    for (const node of childrenByParent.get(parentId) ?? []) {
      skeletonNodes.push(node)
      collectSkeleton(node.id)
    }
  }
  collectSkeleton(null)
  const hasMessageNodes = skeletonNodes.some(node => node.kind === 'message')
  const inlineContributions = new Map(activeContributions
    .filter(c => !c.capabilities.targetAnchorId)
    .map(c => [c.sourceRef.sourceNodeId, c]))

  function collectVirtualFragments(node: SourceNode, inheritedRole?: PromptProviderRole): PromptFragment[] {
    const anchorId = node.capabilities?.targetAnchorId ?? node.id
    const sequence = isPromptMessageSequence(node)
    // ponytail: Persisted presets may still wrap Session history in a Message. Preserve native roles
    // until those author trees are explicitly edited; resource writes reject new nested sequences.
    if ((childrenByParent.get(node.id)?.length ?? 0) > 0) throw new Error('Prompt inlets cannot contain children')
    const fragments: PromptFragment[] = []
    const appendMounts = (mounts: PromptContribution[]) => {
      mounts
        .filter(m => m.messages?.length || m.content && m.content.trim().length > 0)
        .sort((a, b) => (a.capabilities.localDepth ?? Number.MAX_SAFE_INTEGER) - (b.capabilities.localDepth ?? Number.MAX_SAFE_INTEGER))
        .forEach(m => fragments.push({
          id: m.id,
          source: m.sourceRef,
          content: m.content,
          ...(m.messages ? { messages: m.messages } : {}),
          role: m.sourceRef.kind === 'sessionHistory'
            ? m.capabilities.roleHint ?? 'system'
            : inheritedRole ?? m.capabilities.roleHint ?? 'system',
          targetAnchorId: node.id,
          localDepth: m.capabilities.localDepth,
        }))
    }
    const mounts = activeContributions.filter(c => c.capabilities.targetAnchorId === anchorId)
    for (const mount of mounts) {
      if (promptAnchorOutput(anchorId) === 'messages' && mount.sourceRef.kind !== 'sessionHistory')
        throw new Error('Session message sequence cannot receive text contributions')
      if (mount.messages && !sequence) throw new Error('Native messages require a message sequence inlet')
    }
    appendMounts(mounts)

    return fragments
  }

  if (hasMessageNodes) {
    const blocks: PromptFragment[][] = []

    function readMessageRole(node: SourceNode): 'system' | 'user' | 'assistant' {
      const hint = node.capabilities?.roleHint
      if (hint === 'system' || hint === 'user' || hint === 'assistant') {
        return hint
      }
      const meta = node.meta
      if (meta?.includes('user')) return 'user'
      if (meta?.includes('assistant')) return 'assistant'
      return 'system'
    }

    function collectFragments(
      node: SourceNode,
      inheritedRole: 'system' | 'user' | 'assistant',
    ): PromptFragment[] {
      if (node.kind === 'message') throw new Error('Message blocks cannot be nested')
      if (!isActiveNode(node)) return []
      const fragments: PromptFragment[] = []
      if (node.kind === 'entry') {
        const fragment = createEntryFragment(node, inheritedRole, inlineContributions.get(node.id))
        if (fragment) fragments.push(fragment)
      } else if (node.kind === 'virtual') {
        fragments.push(...collectVirtualFragments(node, inheritedRole))
      }

      const children = childrenByParent.get(node.id) ?? []
      for (const child of children) {
        fragments.push(...collectFragments(child, inheritedRole))
      }
      return fragments
    }

    function traverse(nodeId: string | null) {
      const children = childrenByParent.get(nodeId) ?? []
      for (const child of children) {
        if (!isActiveNode(child)) continue
        if (child.kind === 'message') {
          const role = readMessageRole(child)
          const messageChildren = childrenByParent.get(child.id) ?? []
          const frags: PromptFragment[] = []
          for (const item of messageChildren) {
            frags.push(...collectFragments(item, role))
          }
          if (frags.length > 0) {
            blocks.push(frags)
          }
        } else if (child.kind === 'folder' || child.kind === 'module') {
          traverse(child.id)
        } else {
          const frags = child.kind === 'virtual'
            ? collectVirtualFragments(child)
            : collectFragments(child, child.capabilities?.roleHint ?? 'system')
          if (frags.length > 0) {
            blocks.push(frags)
          }
        }
      }
    }

    traverse(null)

    return blocks
  }

  const fragments: PromptFragment[] = []
  
  function dfs(nodeId: string | null) {
    const children = childrenByParent.get(nodeId) ?? []
    for (const child of children) {
      if (!isActiveNode(child)) continue
      if (child.kind === 'folder' || child.kind === 'module') {
        dfs(child.id)
      } else if (child.kind === 'entry') {
        const fragment = createEntryFragment(child, child.capabilities?.roleHint ?? 'system', inlineContributions.get(child.id))
        if (fragment) fragments.push(fragment)
      } else if (child.kind === 'virtual') {
        fragments.push(...collectVirtualFragments(child))
      }
    }
  }
  
  dfs(null)
  
  return [fragments]
}

/** Both traversals read inline text from the skeleton; callers retain role inheritance. */
function createEntryFragment(node: SourceNode, role: PromptProviderRole, contribution?: PromptContribution): PromptFragment | undefined {
  const content = node.body ?? ''
  if (content.trim().length === 0) return undefined
  return {
    id: contribution?.id ?? node.id,
    source: { kind: 'preset', sourceId: node.sourceId, sourceNodeId: node.id },
    content,
    role,
    targetAnchorId: node.capabilities?.targetAnchorId,
  }
}

export function emitPromptBlocks(blocks: PromptFragment[][]): CompiledPrompt {
  const messages: CompiledMessage[] = []
  for (const fragments of blocks) {
    const block: CompiledMessage[] = []
    let previousWasSession = false
    for (const fragment of fragments) {
      const session = fragment.source.kind === 'sessionHistory'
      if (fragment.messages) {
        if (!session) throw new Error('Native Prompt messages must come from Session history')
        block.push(...fragment.messages.map(message => ({
          ...structuredClone(message), content: message.content ?? '', fragmentIds: [fragment.id],
        })))
        previousWasSession = true
        continue
      }
      if (!fragment.content.trim()) continue
      const previous = block[block.length - 1]
      if (previous && previous.role === fragment.role && !session && !previousWasSession) {
        previous.content += '\n\n' + fragment.content
        previous.fragmentIds.push(fragment.id)
      } else {
        block.push({ role: fragment.role, content: fragment.content, fragmentIds: [fragment.id] })
      }
      previousWasSession = session
    }
    messages.push(...block)
  }
  return {
    messages,
    editorProjection: {
      sourceRows: [],
      promptRows: [],
    },
  }
}

// Observation has its own small budget before any snapshot copy; it never throws
// through the Prompt execution path. Store limits apply independently afterwards.
const evidenceBudgets = new WeakMap<ObservationBuild, { remaining: number; items: number }>()
export function captureBuildEvidence(work: () => void): void {
  try { work() } catch { /* best-effort observation must not change Prompt behavior */ }
}
export function appendBuildEvidence<K extends 'sources' | 'variables' | 'transformations' | 'diagnostics'>(
  observation: ObservationBuild | undefined, key: K, value: NonNullable<ObservationBuild[K]>[number],
): void {
  if (!observation) return
  captureBuildEvidence(() => {
    const budget = evidenceBudgets.get(observation) ?? { remaining: 512_000, items: 8_000 }
    evidenceBudgets.set(observation, budget)
    const measure = (item: unknown): boolean => {
      if (--budget.items < 0) return false
      if (typeof item === 'string') budget.remaining -= item.length * 2
      else if (item && typeof item === 'object') {
        for (const key in item) if (Object.hasOwn(item, key)) {
          budget.remaining -= key.length * 2
          if (!measure((item as Record<string, unknown>)[key])) return false
        }
      }
      return budget.remaining >= 0
    }
    if (!measure(value)) {
      if (!observation.diagnostics?.some(item => (item as { code?: string })?.code === 'observation.budget_exceeded'))
        (observation.diagnostics ??= []).push({ code: 'observation.budget_exceeded', message: 'Build evidence is partial: capture budget exceeded.' })
      return
    }
    const values: unknown[] = observation[key] ??= []
    values.push(structuredClone(value))
  })
}
export function recordPromptSources(model: PromptDataModel, observation?: ObservationBuild): void {
  if (!observation) return
  captureBuildEvidence(() => {
    if (observation.sources) return
    observation.sources = []
    const targetsBySource = new Map<string, Set<string>>()
    for (const contribution of model.contributions) {
      const target = contribution.capabilities.targetAnchorId
      if (!target) continue
      const targets = targetsBySource.get(contribution.sourceRef.sourceNodeId) ?? new Set<string>()
      if (targets.size < 128) targets.add(target)
      targetsBySource.set(contribution.sourceRef.sourceNodeId, targets)
    }
    const targetAnchorIds = (id: string, target?: string): string[] | undefined => {
      const targets = new Set(target ? [target] : [])
      for (const value of targetsBySource.get(id) ?? []) if (targets.size < 128) targets.add(value)
      return targets.size ? [...targets] : undefined
    }
    const activationEvidence = (capabilities: SourceNode['capabilities'] | PromptContribution['capabilities']) => {
      const lifecycle = capabilities && 'lifecycle' in capabilities ? capabilities.lifecycle : undefined
      return {
        activationKind: capabilities?.activation?.kind ?? 'always',
        lifecycle: lifecycle && typeof lifecycle === 'object' && 'lifecycle' in lifecycle && typeof lifecycle.lifecycle === 'string'
          ? lifecycle.lifecycle : undefined,
      }
    }
    for (const node of model.sourceNodes) appendBuildEvidence(observation, 'sources', {
      id: node.id, title: node.displayName, path: node.evidence?.path,
      nodeKind: node.kind, parentId: node.parentId ?? undefined, orderIndex: node.orderIndex,
      ...activationEvidence(node.capabilities),
      ...(node.kind === 'virtual'
        ? { anchorIds: [...new Set([node.id, node.capabilities?.targetAnchorId].filter((id): id is string => Boolean(id)))] }
        : { targetAnchorIds: targetAnchorIds(node.id, node.capabilities?.targetAnchorId) }),
      resourceId: node.evidence?.resourceId, version: node.evidence?.version,
      active: false, reason: node.evidence?.disabledReason ?? (node.enabled === false ? 'author disabled' : 'not evaluated in selected skeleton'),
    })
    const known = new Set(model.sourceNodes.map(node => node.id))
    for (const contribution of model.contributions) if (!known.has(contribution.sourceRef.sourceNodeId)) {
      known.add(contribution.sourceRef.sourceNodeId)
      appendBuildEvidence(observation, 'sources', { id: contribution.sourceRef.sourceNodeId, title: contribution.sourceRef.sourceNodeId,
        targetAnchorIds: targetAnchorIds(contribution.sourceRef.sourceNodeId),
        ...activationEvidence(contribution.capabilities),
        active: false, reason: 'not evaluated' })
    }
  })
}
export function emitObservedPromptBlocks(blocks: PromptFragment[][], model: PromptDataModel, observation?: ObservationBuild): CompiledPrompt {
  const projection = emitPromptBlocks(blocks)
  captureBuildEvidence(() => {
    if (!observation) return
    const nodes = new Map(model.sourceNodes.map(node => [node.id, node]))
    for (const [blockIndex, block] of blocks.entries()) for (const [fragmentIndex, fragment] of block.entries()) {
      if (fragment.messages ? fragment.messages.length === 0 : !fragment.content.trim()) continue
      const source = observation.sources?.find(source => source.id === fragment.source.sourceNodeId)
      if (!source) continue
      const original = nodes.get(fragment.source.sourceNodeId)?.evidence?.original ?? nodes.get(fragment.source.sourceNodeId)?.body ?? model.contributions.find(item => item.id === fragment.id)?.content
      appendBuildEvidence(observation, 'transformations', {
        kind: 'emission', hostId: source.id, fragmentId: fragment.id,
        sourceNodeId: source.id, targetAnchorId: fragment.targetAnchorId,
        original, rendered: fragment.content,
        ...(fragment.messages ? { messages: fragment.messages } : {}),
        placement: { blockIndex, fragmentIndex, role: fragment.role, targetAnchorId: fragment.targetAnchorId, localDepth: fragment.localDepth },
      })
      const evidence = observation.transformations?.at(-1) as { kind?: string; fragmentId?: string; original?: string; rendered?: string; placement?: unknown } | undefined
      if (evidence?.kind === 'emission' && evidence.fragmentId === fragment.id) {
        source.original = evidence.original; source.rendered = evidence.rendered; source.placement = evidence.placement
      }
      if ((source.fragmentIds?.length ?? 0) < 128) source.fragmentIds = [...(source.fragmentIds ?? []), fragment.id]
      else appendBuildEvidence(observation, 'diagnostics', { code: 'observation.fragment_limit', hostId: source.id })
    }
    for (const source of observation.sources ?? []) {
      if (source.active && !source.fragmentIds?.length) source.reason += '; no emitted fragment (empty content, unavailable anchor, or excluded subtree)'
    }
    observation.messages = projection.messages
    observation.messageFragments = projection.messages.slice(0, 1000).map(message => message.fragmentIds)
    if (projection.messages.length > 1000) appendBuildEvidence(observation, 'diagnostics', { code: 'observation.message_fragment_limit' })
    projection.observation = observation
  })
  return projection
}

export function recordMacroReads(observation: ObservationBuild, trace: import('@loom-studio/shared').VariableRenderTrace): void {
  captureBuildEvidence(() => {
    for (const read of trace.reads) appendBuildEvidence(observation, 'variables', {
      name: read.requestedPath, path: read.resolvedPath, source: read.source,
      value: read.value, hostId: read.hostId, stage: read.stage,
    })
    for (const diagnostic of trace.diagnostics) appendBuildEvidence(observation, 'diagnostics', diagnostic)
  })
}
