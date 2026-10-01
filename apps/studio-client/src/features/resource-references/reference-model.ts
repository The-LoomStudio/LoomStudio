import { parseResourceReference, type ResourceReference } from '@loom-studio/shared'
import { stringify } from 'yaml'
import type { StudioApi } from '../../shared/api/studio-api.js'
import type { ContextAssetNode } from '../../entities/context-asset.js'

export type ReferenceView = {
  title: string
  path?: string
  body: string
  exact: boolean
  range: { startLine: number; endLine: number } | undefined
  editor?: { resourceId: string; nodeId: string; panel: 'resource' | 'preset' }
}

export async function loadResourceReference(api: Pick<StudioApi, 'promptResources' | 'states' | 'loomScripts'>, uri: string): Promise<ReferenceView> {
  const reference = parseResourceReference(uri)
  if (!reference) throw new Error('无效的资源引用。')
  if (reference.kind === 'prompt-resource') {
    const { resource } = await api.promptResources.get(reference.resourceId)
    const nodes = findNodePath(resource.rootNode, reference.nodeId)
    const node = nodes?.at(-1)
    if (!nodes || !node || typeof node.body !== 'string') throw new Error('引用的正文节点已不存在或无法读取。')
    return view(reference, node.label, node.body, resource.version === reference.version, {
      resourceId: resource.id, nodeId: node.id, panel: resource.resourceKind === 'preset' ? 'preset' : 'resource',
    }, `资源 / ${nodes.map(item => item.label).join(' / ')}`)
  }
  if (reference.kind === 'state') {
    const { snapshot } = await api.states.get(reference.target)
    let value: unknown = snapshot.value
    for (const segment of reference.pointer === '' ? [] : reference.pointer.slice(1).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'))) {
      if (value === null || typeof value !== 'object' || !Object.hasOwn(value, segment))
        throw new Error('引用的 State 路径已不存在。')
      value = (value as Record<string, unknown>)[segment]
    }
    const target = reference.target.scope === 'global' ? '全局 State' : `State · ${reference.target.timelineId} / ${reference.target.branchId}`
    return view(reference, `${target}${reference.pointer}`, stringify(value), snapshot.revisionId === reference.revisionId)
  }
  const before = (await api.loomScripts.get(reference.documentId)).script
  const { artifact } = await api.loomScripts.export(reference.documentId)
  const after = (await api.loomScripts.get(reference.documentId)).script
  if (before.version !== after.version) throw new Error('脚本在读取过程中发生变化，请重新打开引用。')
  return view(reference, after.name, artifact.source, after.version === reference.version)
}

function findNodePath(node: ContextAssetNode, id: string): ContextAssetNode[] | undefined {
  if (node.id === id) return [node]
  for (const child of node.children ?? []) {
    const path = findNodePath(child, id)
    if (path) return [node, ...path]
  }
  return undefined
}

function view(reference: ResourceReference, title: string, body: string, exact: boolean, editor?: ReferenceView['editor'], path?: string): ReferenceView {
  const lines = body.split('\n').length
  return {
    title, body, exact, path,
    range: exact && reference.endLine <= lines ? { startLine: reference.startLine, endLine: reference.endLine } : undefined,
    ...(editor ? { editor } : {}),
  }
}
