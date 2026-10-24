/** Fixed, verifiable input to an extension task. IDs remain opaque to the model. */
export type ExtensionNarrativeSource = {
  timelineId: string
  branchId: string
  afterNodeId?: string
  throughNodeId: string | null
  nodeIds: string[]
  digest: string
}
export type ExtensionNarrativeRead = {
  selection: { kind: 'floors'; from: number; through: number; throughNodeId?: string }
    | { kind: 'range'; afterNodeId?: string; throughNodeId?: string }
    | { kind: 'tail'; count: number; throughNodeId?: string }
  maxNodes?: number
  maxCharacters?: number
}
export type ExtensionNarrativeSnapshot = {
  source: ExtensionNarrativeSource
  nodes: Array<{ id: string; floor: number; parentNodeId: string | null; content: string }>
  complete: boolean
  missingFloors?: number[]
}
export type ExtensionNarrativeActivity = {
  /** Post-commit invalidation hint. Re-read and validate the source before writing. */
  kind: 'changed'
  timelineId: string
  branchId: string
  headNodeId: string | null
  /** Identifies the committed changeset; it is not a sortable branch revision. */
  changesetId: string
  committedAt: string
} | {
  kind: 'input' | 'run-completed'
  timelineId: string
  branchId: string
  nodeId: string | null
  agentSessionId?: string
}
export type ExtensionReadonlyFiles = {
  id: string
  /** One absolute root, e.g. /story-memory. Built-in roots cannot be shadowed. */
  root: string
  resolve(target: { timelineId: string; branchId: string }): Promise<Array<{
    path: string
    kind: 'directory' | 'file'
    content?: string
  }>>
}

export type ExtensionRecordArchive = {
  id: string
  version: number
  /** Pure data conversion: no temporary Timeline storage permission is granted. */
  remap(input: {
    recordId: string
    recordType: string
    data: import('@loom-studio/shared').JsonValue
    sourceTimelineId: string
    recordIds: Record<string, string>
    idMap: { timelineId: string; branchIds: Record<string, string>; nodeIds: Record<string, string>; stateRevisionIds: Record<string, string> }
  }): import('@loom-studio/shared').JsonValue | Promise<import('@loom-studio/shared').JsonValue>
}
