import { evaluatePromptActivation, type ActivationFacts } from './prompt-activation.js'
import type {
  CompiledMessage,
  CompiledPrompt,
  PromptContribution,
  PromptFragment,
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
  
  const fragments: PromptFragment[] = []
  
  function dfs(nodeId: string | null) {
    const children = childrenByParent.get(nodeId) ?? []
    for (const child of children) {
      if (child.kind === 'folder' || child.kind === 'module') {
        dfs(child.id)
      } else if (child.kind === 'virtual') {
        const anchorId = child.capabilities?.targetAnchorId ?? child.id
        const mounts = activeContributions.filter(c => c.capabilities.targetAnchorId === anchorId)
        mounts.sort((a, b) => (a.capabilities.localDepth ?? Number.MAX_SAFE_INTEGER) - (b.capabilities.localDepth ?? Number.MAX_SAFE_INTEGER))
        for (const m of mounts) {
          fragments.push({
            id: m.id,
            source: m.sourceRef,
            content: m.content,
            role: m.capabilities.roleHint ?? 'system',
            targetAnchorId: child.id,
            localDepth: m.capabilities.localDepth
          })
        }
      }
    }
  }
  
  dfs(null)
  
  const messages: CompiledMessage[] = []
  for (const f of fragments) {
    const lastMessage = messages[messages.length - 1]
    if (lastMessage && lastMessage.role === f.role) {
      lastMessage.content += '\n\n' + f.content
      lastMessage.fragmentIds.push(f.id)
    } else {
      messages.push({
        role: f.role,
        content: f.content,
        fragmentIds: [f.id]
      })
    }
  }
  
  return {
    messages,
    editorProjection: {
      sourceRows: [],
      promptRows: []
    }
  }
}
