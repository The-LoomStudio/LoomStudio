export type RpcCapability = {
  name: string
  owner: 'kernel' | 'application' | `extension:${string}` | string
  namespace: string
  description?: string
  stability: 'internal' | 'experimental' | 'stable'
  inputSchema?: unknown
  outputSchema?: unknown
}

export function createNamespaceRpcCapabilities(options: {
  names: readonly string[]
  namespace: string
  owner: RpcCapability['owner']
  stability: RpcCapability['stability']
}): RpcCapability[] {
  return options.names.map(name => ({
    name,
    namespace: options.namespace,
    owner: options.owner,
    stability: options.stability,
  }))
}
