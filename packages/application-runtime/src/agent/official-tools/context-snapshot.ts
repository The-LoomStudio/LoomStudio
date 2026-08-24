import type { CompiledPrompt, PromptContribution, SourceNode } from '../../prompt-builder.js'
import type { ToolExecutionScope } from '../tool-registry.js'

export function createPromptToolExecutionScope(input: {
  prompt: CompiledPrompt
  contributions: readonly PromptContribution[]
  sourceNodes: readonly SourceNode[]
}): ToolExecutionScope {
  const sourceNodes = new Map(input.sourceNodes.map(node => [node.id, node]))
  const injectedIds = new Set(input.prompt.messageBlocks.flatMap(block => block.fragmentIds))
  return {
    context: input.contributions
      .filter(contribution => contribution.capabilities.projection?.zoneId !== 'tools')
      .map(contribution => {
        const projection = contribution.capabilities.projection!
        const sourceNode = sourceNodes.get(contribution.sourceRef.sourceNodeId)
        return {
          id: contribution.id,
          name: sourceNode?.displayName ?? contribution.id,
          zoneId: projection.zoneId,
          slotKey: projection.joinSlotKey ?? projection.sourceSlotKey ?? contribution.sourceRef.sourceNodeId,
          sourceKind: contribution.sourceRef.kind,
          sourceId: contribution.sourceRef.sourceId,
          promptState: injectedIds.has(contribution.id)
            ? 'injected' as const
            : contribution.capabilities.activation
              ? 'not-triggered' as const
              : 'agent-only' as const,
          content: contribution.content,
        }
      }),
  }
}
