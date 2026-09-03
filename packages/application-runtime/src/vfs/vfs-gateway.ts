import type { PromptResourceNode } from '../cards/workspace.js'

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
