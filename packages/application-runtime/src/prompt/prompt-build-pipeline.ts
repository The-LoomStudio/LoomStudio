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
}

export function compilePromptDataModel(input: {
  contributions: PromptContribution[]
  sourceNodes: SourceNode[]
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
  
  const hasMessageNodes = sourceNodes.some(node => node.kind === 'message')

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
      const fragments: PromptFragment[] = []
      if (node.kind === 'entry') {
        const content = node.body ?? ''
        if (content.trim().length > 0) {
          fragments.push({
            id: node.id,
            source: { kind: 'preset', sourceId: node.sourceId, sourceNodeId: node.id },
            content,
            role: inheritedRole,
            targetAnchorId: node.capabilities?.targetAnchorId,
            localDepth: node.capabilities?.localDepth,
          })
        }
      } else if (node.kind === 'virtual') {
        const anchorId = node.capabilities?.targetAnchorId ?? node.id
        const mounts = activeContributions.filter(c => c.capabilities.targetAnchorId === anchorId)
        mounts.sort((a, b) => (a.capabilities.localDepth ?? Number.MAX_SAFE_INTEGER) - (b.capabilities.localDepth ?? Number.MAX_SAFE_INTEGER))
        for (const m of mounts) {
          if (m.content && m.content.trim().length > 0) {
            fragments.push({
              id: m.id,
              source: m.sourceRef,
              content: m.content,
              role: inheritedRole,
              targetAnchorId: node.id,
              localDepth: m.capabilities.localDepth,
            })
          }
        }
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
        if (child.kind === 'message') {
          const role = readMessageRole(child)
          const messageChildren = childrenByParent.get(child.id) ?? []
          const frags: PromptFragment[] = []
          for (const item of messageChildren) {
            frags.push(...collectFragments(item, role))
          }
          if (frags.length > 0) {
            messages.push({
              role,
              content: frags.map(f => f.content).join('\n\n'),
              fragmentIds: frags.map(f => f.id),
            })
          }
        } else if (child.kind === 'folder' || child.kind === 'module') {
          traverse(child.id)
        } else {
          const frags = collectFragments(child, (child.capabilities?.roleHint as 'system' | 'user' | 'assistant' | 'developer') ?? 'system')
          if (frags.length > 0) {
            messages.push({
              role: frags[0]?.role ?? 'system',
              content: frags.map(f => f.content).join('\n\n'),
              fragmentIds: frags.map(f => f.id),
            })
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
      if (child.kind === 'folder' || child.kind === 'module') {
        dfs(child.id)
      } else if (child.kind === 'entry') {
        const content = child.body ?? ''
        if (content.trim().length > 0) {
          fragments.push({
            id: child.id,
            source: { kind: 'preset', sourceId: child.sourceId, sourceNodeId: child.id },
            content,
            role: (child.capabilities?.roleHint as PromptProviderRole | undefined) ?? 'system',
            targetAnchorId: child.capabilities?.targetAnchorId,
            localDepth: child.capabilities?.localDepth,
          })
        }
      } else if (child.kind === 'virtual') {
        const anchorId = child.capabilities?.targetAnchorId ?? child.id
        const mounts = activeContributions.filter(c => c.capabilities.targetAnchorId === anchorId)
        mounts.sort((a, b) => (a.capabilities.localDepth ?? Number.MAX_SAFE_INTEGER) - (b.capabilities.localDepth ?? Number.MAX_SAFE_INTEGER))
        for (const m of mounts) {
          if (m.content && m.content.trim().length > 0) {
            fragments.push({
              id: m.id,
              source: m.sourceRef,
              content: m.content,
              role: m.capabilities.roleHint ?? 'system',
              targetAnchorId: child.id,
              localDepth: m.capabilities.localDepth,
            })
          }
        }
      }
    }
  }
  
  dfs(null)
  
  const messages: CompiledMessage[] = []
  for (const f of fragments) {
    if (!f.content || f.content.trim().length === 0) continue
    const lastMessage = messages[messages.length - 1]
    if (lastMessage && lastMessage.role === f.role) {
      lastMessage.content += '\n\n' + f.content
      lastMessage.fragmentIds.push(f.id)
    } else {
      messages.push({
        role: f.role,
        content: f.content,
        fragmentIds: [f.id],
      })
    }
  }
  
  return {
    messages,
    editorProjection: {
      sourceRows: [],
      promptRows: [],
    },
  }
}
