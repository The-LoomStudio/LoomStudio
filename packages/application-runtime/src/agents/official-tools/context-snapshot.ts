import type { CompiledPrompt, PromptContribution, SourceNode } from '../../prompt/prompt-builder.js'
import type { ToolExecutionScope } from '../tool-registry.js'
import { resolveVirtualPath, resolveMediaType } from '../../vfs/vfs-gateway.js'

export function createPromptToolExecutionScope(input: {
  prompt: CompiledPrompt
  contributions: readonly PromptContribution[]
  sourceNodes: readonly SourceNode[]
}): ToolExecutionScope {
  const sourceNodes = new Map(input.sourceNodes.map(node => [node.id, node]))
  const injectedIds = new Set(input.prompt.messages.flatMap(message => message.fragmentIds))
  return {
    context: input.contributions
      .filter(contribution => contribution.capabilities.targetAnchorId !== '@chat.tools')
      .map(contribution => {
        const sourceNode = sourceNodes.get(contribution.sourceRef.sourceNodeId)
        return {
          id: contribution.id,
          name: sourceNode?.displayName ?? contribution.id,
          virtualPath: sourceNode ? resolveVirtualPath({ label: sourceNode.displayName, kind: sourceNode.kind }) : `/${contribution.id}`,
          mediaType: sourceNode ? resolveMediaType(sourceNode.kind) : 'text/plain',
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
