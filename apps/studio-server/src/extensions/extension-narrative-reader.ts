import { createHash } from 'node:crypto'
import type { ApplicationRuntime } from '@loom-studio/application-runtime'
import type { NarrativeStore } from '@loom-studio/application-runtime/data'
import type { ExtensionNarrativeRead, ExtensionNarrativeSnapshot, ExtensionNarrativeSource } from '@loom-studio/extension-sdk'

export function createExtensionNarrativeReader(runtime: ApplicationRuntime, narratives: NarrativeStore) {
  const digest = (nodes: ExtensionNarrativeSnapshot['nodes']) => createHash('sha256').update(JSON.stringify(nodes.map(({ floor, content }) => ({ floor, content })))).digest('hex')
  return {
    async read(target: { timelineId: string; branchId: string }, input: ExtensionNarrativeRead, signal?: AbortSignal): Promise<ExtensionNarrativeSnapshot> {
      const sample = await runtime.sampleNarrative({ selection: input.selection, maxNodes: input.maxNodes, maxCharacters: input.maxCharacters, ...target }, signal)
      const nodes = sample.nodes.map(node => ({ id: node.id, floor: node.floor, parentNodeId: node.parentNodeId ?? null, content: node.body.raw }))
      return { source: { ...target, afterNodeId: nodes[0]?.parentNodeId ?? undefined,
        throughNodeId: nodes.at(-1)?.id ?? null, nodeIds: nodes.map(node => node.id), digest: digest(nodes) }, nodes, complete: sample.complete,
        ...(sample.missingFloors ? { missingFloors: sample.missingFloors } : {}) }
    },
    async validate(target: { timelineId: string; branchId: string }, source: ExtensionNarrativeSource, signal?: AbortSignal): Promise<boolean> {
      if (source.timelineId !== target.timelineId) return false
      const branch = await narratives.getBranch(target.branchId)
      if (!branch || branch.timelineId !== target.timelineId) return false
      if (source.throughNodeId === null) return !branch.headNodeId && source.nodeIds.length === 0 && source.digest === digest([])
      let nodeId: string | null | undefined = branch.headNodeId
      while (nodeId && nodeId !== source.throughNodeId) {
        signal?.throwIfAborted()
        nodeId = (await narratives.getNode(nodeId))?.parentNodeId ?? null
      }
      if (!nodeId) return false
      const nodes: ExtensionNarrativeSnapshot['nodes'] = []
      while (nodeId && nodeId !== source.afterNodeId) {
        signal?.throwIfAborted()
        const node = await narratives.getNode(nodeId)
        if (!node) return false
        nodes.push({ id: node.id, floor: node.floor, parentNodeId: node.parentNodeId ?? null, content: node.body.raw })
        nodeId = node.parentNodeId
      }
      if (source.afterNodeId && nodeId !== source.afterNodeId) return false
      nodes.reverse()
      return nodes.length === source.nodeIds.length && nodes.every((node, index) => node.id === source.nodeIds[index])
        && source.digest === digest(nodes)
    },
  }
}
