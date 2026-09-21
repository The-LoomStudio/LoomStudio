export type VfsEntry = {
  path: string
  kind: 'directory' | 'file'
  content?: string
  state?: 'injected' | 'not-triggered' | 'agent-only' | 'current' | 'disabled' | 'locked'
  binding?: VfsBinding
}

export type VfsBinding =
  | { kind: 'prompt-resource'; resourceId: string; nodeId: string; version: number; field: 'body' | 'metadata' }
  | { kind: 'state'; target: VfsStateTarget; revisionId: string; pointer: string }
  | { kind: 'script'; documentId: string; version: number; blobId: string; mountId: string }

export type VfsStateTarget = { scope: 'global' } | { scope: 'timeline'; timelineId: string; branchId: string }

export type VfsReadObservation = {
  path: string
  startLine: number
  endLine: number
  totalLines: number
  binding?: VfsBinding
}

export type VfsMutationPreview = {
  action: 'replace' | 'patch' | 'move' | 'delete' | 'create' | 'copy'
  path: string
  kind: 'prompt-resource' | 'state'
  before: string
  after: string
  target?: VfsStateTarget
  pointer?: string
}

export type VfsMutationDecision =
  | { decision: 'allow' }
  | { decision: 'deny'; reason?: string }

export type VfsApprovalControl = {
  waitForUser<T>(operation: () => Promise<T>): Promise<T>
}
