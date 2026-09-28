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

export function compilePromptDataModel(input: {
  contributions: PromptContribution[]
  sourceNodes: SourceNode[]
  skeletonRootId?: string
  currentInput?: string
  activationFacts?: ActivationFacts
}): CompiledPrompt {
  const { contributions, sourceNodes, activationFacts } = input
  
  const activeContributions = contributions.filter(c => {
    if (c.capabilities.activation) {
      return evaluatePromptActivation({
        activation: c.capabilities.activation,
        currentInput: input.currentInput,
        facts: activationFacts ?? {},
      }).active
    }
    return true
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
  const isActiveNode = (node: SourceNode) => node.enabled !== false && (
    !node.capabilities?.activation || evaluatePromptActivation({
      activation: node.capabilities.activation,
      currentInput: input.currentInput,
      facts: activationFacts ?? {},
    }).active
  )
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
    appendMounts(activeContributions.filter(c => c.capabilities.targetAnchorId === anchorId))
    if (anchorId === '@chat.session') {
      const hasExplicitAnchor = (id: string) => skeletonNodes.some(
        n => n.kind === 'virtual' && (n.capabilities?.targetAnchorId === id || n.id === id),
      )
      if (!hasExplicitAnchor('@setting.lower')) {
        appendMounts(activeContributions.filter(c => c.capabilities.targetAnchorId === '@setting.lower'))
      }
      if (!hasExplicitAnchor('@chat.session.post')) {
        appendMounts(activeContributions.filter(c => c.capabilities.targetAnchorId === '@chat.session.post'))
      }
    }
    return fragments
  }

  function appendFragments(messages: CompiledMessage[], fragments: PromptFragment[]) {
    let previousWasSession = false
    for (const fragment of fragments) {
      const session = fragment.source.kind === 'sessionHistory'
      if (fragment.messages) {
        if (!session) throw new Error('Native Prompt messages must come from Session history')
        messages.push(...fragment.messages.map(message => ({
          ...structuredClone(message), content: message.content ?? '', fragmentIds: [fragment.id],
        })))
        previousWasSession = true
        continue
      }
      const previous = messages[messages.length - 1]
      if (previous && previous.role === fragment.role && !session && !previousWasSession) {
        previous.content += '\n\n' + fragment.content
        previous.fragmentIds.push(fragment.id)
      } else {
        messages.push({ role: fragment.role, content: fragment.content, fragmentIds: [fragment.id] })
      }
      previousWasSession = session
    }
  }

  if (hasMessageNodes) {
    const messages: CompiledMessage[] = []

    function readMessageRole(node: SourceNode): 'system' | 'user' | 'assistant' | 'developer' {
      const hint = node.capabilities?.roleHint
      if (hint === 'system' || hint === 'user' || hint === 'assistant' || hint === 'developer') {
        return hint
      }
      const meta = node.meta
      if (meta?.includes('user')) return 'user'
      if (meta?.includes('assistant')) return 'assistant'
      if (meta?.includes('developer')) return 'developer'
      return 'system'
    }

    function collectFragments(
      node: SourceNode,
      inheritedRole: 'system' | 'user' | 'assistant' | 'developer',
    ): PromptFragment[] {
      if (!isActiveNode(node)) return []
      const fragments: PromptFragment[] = []
      if (node.kind === 'entry') {
        const content = node.body ?? ''
        if (content.trim().length > 0) {
          fragments.push({
            id: inlineContributions.get(node.id)?.id ?? node.id,
            source: { kind: 'preset', sourceId: node.sourceId, sourceNodeId: node.id },
            content,
            role: inheritedRole,
            targetAnchorId: node.capabilities?.targetAnchorId,
            localDepth: node.capabilities?.localDepth,
          })
        }
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
            const block: CompiledMessage[] = []
            appendFragments(block, frags)
            messages.push(...block)
          }
        } else if (child.kind === 'folder' || child.kind === 'module') {
          traverse(child.id)
        } else {
          const frags = child.kind === 'virtual'
            ? collectVirtualFragments(child)
            : collectFragments(child, child.capabilities?.roleHint ?? 'system')
          if (frags.length > 0) {
            const block: CompiledMessage[] = []
            appendFragments(block, frags)
            messages.push(...block)
          }
        }
      }
    }

    traverse(null)

    return {
      messages,
      editorProjection: {
        sourceRows: [],
        promptRows: [],
      },
    }
  }

  const fragments: PromptFragment[] = []
  
  function dfs(nodeId: string | null) {
    const children = childrenByParent.get(nodeId) ?? []
    for (const child of children) {
      if (!isActiveNode(child)) continue
      if (child.kind === 'folder' || child.kind === 'module') {
        dfs(child.id)
      } else if (child.kind === 'entry') {
        const content = child.body ?? ''
        if (content.trim().length > 0) {
          fragments.push({
            id: inlineContributions.get(child.id)?.id ?? child.id,
            source: { kind: 'preset', sourceId: child.sourceId, sourceNodeId: child.id },
            content,
            role: (child.capabilities?.roleHint as PromptProviderRole | undefined) ?? 'system',
            targetAnchorId: child.capabilities?.targetAnchorId,
            localDepth: child.capabilities?.localDepth,
          })
        }
      } else if (child.kind === 'virtual') {
        fragments.push(...collectVirtualFragments(child))
      }
    }
  }
  
  dfs(null)
  
  const messages: CompiledMessage[] = []
  appendFragments(messages, fragments)
  
  return {
    messages,
    editorProjection: {
      sourceRows: [],
      promptRows: [],
    },
  }
}
