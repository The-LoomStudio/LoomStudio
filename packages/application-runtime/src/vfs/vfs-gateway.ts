import type { PromptResourceNode } from '../cards/workspace-types.js'
import { createHash } from 'node:crypto'
import type { CompiledPrompt, PromptContribution, SourceNode } from '../prompt/prompt-builder.js'
import type { VfsEntry } from './types.js'

export function createPromptVfsEntries(input: {
  prompt: CompiledPrompt
  sourceNodes: readonly SourceNode[]
  contributions: readonly PromptContribution[]
}): VfsEntry[] {
  const nodes = new Map(input.sourceNodes.map(node => [node.id, node]))
  const injected = new Set(input.prompt.messages.flatMap(message => message.fragmentIds))
  const contributions = input.contributions.filter(item =>
    item.sourceRef.kind === 'preset' || item.sourceRef.kind === 'settingLayer',
  )
  const readable = new Map(contributions.map(item => [item.sourceRef.sourceNodeId, item]))
  const allowed = new Set<string>()
  for (const contribution of contributions) {
    let node = nodes.get(contribution.sourceRef.sourceNodeId)
    while (node && node.enabled !== false && !allowed.has(node.id)) {
      allowed.add(node.id)
      node = node.parentId ? nodes.get(node.parentId) : undefined
    }
  }
  const entries: VfsEntry[] = [{ path: '/', kind: 'directory' }]
  const paths = new Set(['/'])
  const children = new Map<string | null, SourceNode[]>()
  for (const node of input.sourceNodes) {
    if (!allowed.has(node.id) || node.enabled === false) continue
    const siblings = children.get(node.parentId) ?? []
    siblings.push(node)
    children.set(node.parentId, siblings)
  }
  function visit(parentId: string | null, parentPath: string) {
    const siblings = (children.get(parentId) ?? []).sort((a, b) => a.orderIndex - b.orderIndex)
    const names = siblings.map(node => {
      const label = Array.from(node.displayName.normalize('NFC').trim(), char =>
        char === '/' || char === '\\' || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? '_' : char,
      ).join('')
      const safe = label && label !== '.' && label !== '..' ? label : 'untitled'
      return readable.has(node.id) && !safe.endsWith('.md') ? `${safe}.md` : safe
    })
    const counts = new Map<string, number>()
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
    for (const [index, node] of siblings.entries()) {
      const name = names[index]!
      const duplicate = counts.get(name)! > 1
      const segment = duplicate ? `${name}~${createHash('sha256').update(node.id).digest('hex').slice(0, 10)}` : name
      const path = `${parentPath === '/' ? '' : parentPath}/${segment}`
      if (paths.has(path)) throw new Error('VFS path collision; rename the conflicting resource before using CodeAct.')
      paths.add(path)
      const contribution = readable.get(node.id)
      entries.push({
        path, kind: contribution ? 'file' : 'directory',
        ...(contribution ? {
          content: contribution.content,
          state: injected.has(contribution.id) ? 'injected' as const
            : contribution.capabilities.activation ? 'not-triggered' as const : 'agent-only' as const,
        } : {}),
      })
      if (!contribution) visit(node.id, path)
    }
  }
  visit(null, '/context')
  if (entries.length > 1) entries.splice(1, 0, { path: '/context', kind: 'directory' })
  return entries
}

export function resolveVirtualPath(node: Pick<PromptResourceNode, 'label' | 'kind'>): string {
  const extension = resolveVirtualExtension(node.kind)
  const safeName = node.label.replace(/[^a-zA-Z0-9_.\-\u4e00-\u9fa5]/g, '_')
  
  if (extension && !safeName.toLowerCase().endsWith(extension)) {
    return `/${safeName}${extension}`
  }
  
  return `/${safeName}`
}

export function resolveVirtualExtension(kind: PromptResourceNode['kind']): string | undefined {
  switch (kind) {
    case 'entry':
      return '.md'
    case 'script':
      return '.js'
    case 'virtual':
    case 'folder':
    case 'module':
      return undefined
    default:
      return undefined
  }
}

export function resolveMediaType(kind: PromptResourceNode['kind']): string {
  switch (kind) {
    case 'entry':
      return 'text/markdown'
    case 'script':
      return 'application/javascript'
    case 'virtual':
      return 'application/x-loom-anchor'
    default:
      return 'application/octet-stream'
  }
}
