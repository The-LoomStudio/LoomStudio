import { formatResourceReference } from '@loom-studio/shared'
import type { VfsReadObservation } from './types.js'

export function formatVfsReference(observation: VfsReadObservation): string | undefined {
  const binding = observation.binding
  if (!binding) return undefined
  const range = { startLine: observation.startLine, endLine: observation.endLine }
  if (binding.kind === 'prompt-resource') return formatResourceReference({
    kind: binding.kind, resourceId: binding.resourceId, nodeId: binding.nodeId, version: binding.version, ...range,
  })
  if (binding.kind === 'script') return formatResourceReference({
    kind: binding.kind, documentId: binding.documentId, version: binding.version, ...range,
  })
  return formatResourceReference({ ...binding, ...range })
}
