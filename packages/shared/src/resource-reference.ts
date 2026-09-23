export type ResourceReference = (
  | { kind: 'prompt-resource'; resourceId: string; nodeId: string; version: number }
  | { kind: 'state'; target: { scope: 'global' } | { scope: 'timeline'; timelineId: string; branchId: string }; revisionId: string; pointer: string }
  | { kind: 'script'; documentId: string; version: number }
) & { startLine: number; endLine: number }

export type EntityReference = {
  kind: 'entity'
  id: string
} & (
  | { type: 'timeline'; branchId?: string; nodeId?: string }
  | { type: 'resource'; branchId?: never; nodeId?: string }
  | { type: 'card' | 'session' | 'run' | 'provider' | 'extension'; branchId?: never; nodeId?: never }
)

export function formatEntityReference(reference: EntityReference): string {
  const url = new URL('loom-resource://entity')
  url.searchParams.set('type', reference.type)
  url.searchParams.set('id', reference.id)
  if (reference.branchId !== undefined) url.searchParams.set('branchId', reference.branchId)
  if (reference.nodeId !== undefined) url.searchParams.set('nodeId', reference.nodeId)
  if (!parseEntityReference(url.href)) throw new Error('Invalid entity reference')
  return url.href
}

export function parseEntityReference(uri: string): EntityReference | undefined {
  if (uri.length > 8192) return undefined
  try {
    const url = new URL(uri)
    if (url.protocol !== 'loom-resource:' || url.hostname !== 'entity' || url.username || url.password || url.port || url.pathname || url.hash) return undefined
    const type = url.searchParams.get('type')
    const id = url.searchParams.get('id')
    const allowedKeys = type === 'timeline' ? ['type', 'id', 'branchId', 'nodeId']
      : type === 'resource' ? ['type', 'id', 'nodeId'] : ['type', 'id']
    if ([...url.searchParams.keys()].some(key => !allowedKeys.includes(key) || url.searchParams.getAll(key).length !== 1)) return undefined
    if (!type || !['card', 'timeline', 'session', 'run', 'resource', 'provider', 'extension'].includes(type) || !id || /[\u0000-\u001f\u007f]/.test(id)) return undefined
    const branchId = url.searchParams.get('branchId')
    const nodeId = url.searchParams.get('nodeId')
    if ([branchId, nodeId].some(value => value !== null && (!value || /[\u0000-\u001f\u007f]/.test(value)))) return undefined
    if (type === 'timeline') return { kind: 'entity', type, id, ...(branchId !== null ? { branchId } : {}), ...(nodeId !== null ? { nodeId } : {}) }
    if (type === 'resource') return { kind: 'entity', type, id, ...(nodeId !== null ? { nodeId } : {}) }
    return { kind: 'entity', type: type as Exclude<EntityReference['type'], 'timeline' | 'resource'>, id }
  } catch { return undefined }
}

export function parseResourceLink(uri: string): ResourceReference | EntityReference | undefined {
  return parseEntityReference(uri) ?? parseResourceReference(uri)
}

export function formatResourceReference(reference: ResourceReference): string {
  const url = new URL(`loom-resource://${reference.kind}`)
  if (reference.kind === 'prompt-resource') {
    url.searchParams.set('resource', reference.resourceId)
    url.searchParams.set('node', reference.nodeId)
    url.searchParams.set('version', String(reference.version))
  } else if (reference.kind === 'script') {
    url.searchParams.set('document', reference.documentId)
    url.searchParams.set('version', String(reference.version))
  } else {
    url.searchParams.set('scope', reference.target.scope)
    if (reference.target.scope === 'timeline') {
      url.searchParams.set('timeline', reference.target.timelineId)
      url.searchParams.set('branch', reference.target.branchId)
    }
    url.searchParams.set('revision', reference.revisionId)
    url.searchParams.set('pointer', reference.pointer)
  }
  url.hash = `L${reference.startLine}-L${reference.endLine}`
  const uri = url.href
  if (!parseResourceReference(uri)) throw new Error('Invalid resource reference.')
  return uri
}

export function parseResourceReference(uri: string): ResourceReference | undefined {
  if (uri.length > 8192) return undefined
  try {
    const url = new URL(uri)
    if (url.protocol !== 'loom-resource:' || url.username || url.password || url.port || url.pathname) return undefined
    const match = /^#L([1-9]\d*)-L([1-9]\d*)$/.exec(url.hash)
    if (!match) return undefined
    const startLine = Number(match[1])
    const endLine = Number(match[2])
    if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || endLine < startLine) return undefined
    const params = url.searchParams
    const text = (key: string) => {
      const value = params.get(key)
      return value && !/[\u0000-\u001f\u007f]/.test(value) ? value : undefined
    }
    const only = (keys: string[]) => [...params.keys()].every(key => keys.includes(key) && params.getAll(key).length === 1)
    const version = Number(params.get('version'))
    const validVersion = /^[1-9]\d*$/.test(params.get('version') ?? '') && Number.isSafeInteger(version)
    const range = { startLine, endLine }
    if (url.hostname === 'prompt-resource' && only(['resource', 'node', 'version']) && text('resource') && text('node') && validVersion)
      return { kind: 'prompt-resource', resourceId: text('resource')!, nodeId: text('node')!, version, ...range }
    if (url.hostname === 'script' && only(['document', 'version']) && text('document') && validVersion)
      return { kind: 'script', documentId: text('document')!, version, ...range }
    if (url.hostname === 'state' && only(['scope', 'timeline', 'branch', 'revision', 'pointer']) && text('revision')) {
      const pointer = params.get('pointer')
      if (pointer === null || (pointer !== '' && !pointer.startsWith('/')) || /~(?![01])|[\u0000-\u001f\u007f]/.test(pointer)) return undefined
      if (params.get('scope') === 'global' && !params.has('timeline') && !params.has('branch'))
        return { kind: 'state', target: { scope: 'global' }, revisionId: text('revision')!, pointer, ...range }
      if (params.get('scope') === 'timeline' && text('timeline') && text('branch'))
        return { kind: 'state', target: { scope: 'timeline', timelineId: text('timeline')!, branchId: text('branch')! }, revisionId: text('revision')!, pointer, ...range }
    }
  } catch {
    return undefined
  }
  return undefined
}
