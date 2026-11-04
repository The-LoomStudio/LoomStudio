import { SaxesParser } from 'saxes'
import type { AuthoringNode } from '@loom-studio/shared'

type Element = { tag: string; attrs: Record<string, string>; children: Element[]; line: number }
type Metadata = Record<string, Record<string, unknown>>
const encode = (value: string) => value.replace(/[&<>"\r\n\t]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\r': '&#13;', '\n': '&#10;', '\t': '&#9;' })[char]!)
const attr = (key: string, value: string) => ` ${key}="${encode(value)}"`

/** XML contains composition only. Arbitrary node metadata remains in resource.yaml. */
export function projectPresetComposition(nodes: AuthoringNode[], writeEntry: (node: AuthoringNode, index: number) => string) {
  const metadata: Metadata = Object.create(null)
  let entryIndex = 0
  const visit = (node: AuthoringNode, depth: number): string => {
    const indent = '  '.repeat(depth)
    if (node.kind === 'entry') return `${indent}<Entry${attr('src', `./${writeEntry(node, entryIndex++)}`)} />`
    const { id, label, kind, children: _children, ...rest } = node
    const properties = structuredClone(rest)
    const capabilities = { ...properties.capabilities }
    let attrs = attr('id', id) + attr('name', label)
    for (const key of ['enabled', 'category', 'meta'] as const) {
      if (properties[key] !== undefined) attrs += attr(key, String(properties[key]))
      delete properties[key]
    }
    if (kind === 'message') {
      const role = capabilities.roleHint ?? 'system'
      attrs += attr('role', String(role))
      delete capabilities.roleHint
    } else if (kind === 'virtual' && typeof capabilities.targetAnchorId === 'string') {
      attrs += attr('anchor', capabilities.targetAnchorId)
      delete capabilities.targetAnchorId
    }
    if (Object.keys(capabilities).length) properties.capabilities = capabilities
    else delete properties.capabilities
    if (Object.keys(properties).length) metadata[id] = properties
    const tag = kind === 'message' ? 'Message' : kind === 'folder' ? 'Group' : 'Slot'
    if (kind === 'virtual') return `${indent}<${tag}${attrs} />`
    return `${indent}<${tag}${attrs}>\n${(node.children ?? []).map(child => visit(child, depth + 1)).join('\n')}\n${indent}</${tag}>`
  }
  const xml = `<Preset>\n${nodes.map(node => visit(node, 1)).join('\n')}\n</Preset>\n`
  return { xml, metadata }
}

export function restorePresetComposition(text: string, metadata: Metadata, readEntry: (path: string) => AuthoringNode): AuthoringNode[] {
  const parser = new SaxesParser({ xmlns: false })
  const stack: Element[] = []
  let root: Element | undefined
  const fail = (message: string, line = parser.line): never => { throw new Error(`composition.xml:${line}: ${message}`) }
  parser.on('error', error => fail(error.message))
  parser.on('doctype', () => fail('DOCTYPE is not allowed'))
  parser.on('processinginstruction', () => fail('Processing instructions are not allowed'))
  parser.on('text', value => { if (value.trim()) fail('Composition cannot contain text; use an Entry file') })
  parser.on('cdata', () => fail('Composition cannot contain CDATA'))
  parser.on('opentag', tag => {
    if (stack.length > 129) fail('Tree exceeds 128 levels')
    const element: Element = { tag: tag.name, attrs: tag.attributes as Record<string, string>, children: [], line: parser.line }
    if (stack.length) stack[stack.length - 1]!.children.push(element)
    else root = element
    stack.push(element)
  })
  parser.on('closetag', () => { stack.pop() })
  parser.write(text).close()
  if (!root || root.tag !== 'Preset' || Object.keys(root.attrs).length) fail('Expected <Preset> root without attributes')
  const usedMetadata = new Set<string>()
  const usedPaths = new Set<string>()
  const ids = new Set<string>()
  const visit = (element: Element): AuthoringNode => {
    const { tag, attrs, children, line } = element
    const allowed = tag === 'Entry' ? ['src'] : tag === 'Message' ? ['id', 'name', 'role', 'enabled', 'category', 'meta'] : tag === 'Slot' ? ['id', 'name', 'anchor', 'enabled', 'category', 'meta'] : tag === 'Group' ? ['id', 'name', 'enabled', 'category', 'meta'] : undefined
    if (!allowed) return fail(`Unknown element ${tag}`, line)
    for (const key of Object.keys(attrs)) if (!allowed.includes(key)) fail(`Unknown ${tag} attribute ${key}`, line)
    let node: AuthoringNode
    if (tag === 'Entry') {
      if (children.length || !attrs.src?.startsWith('./')) fail('Entry requires a ./ relative src and no children', line)
      const path = attrs.src!.slice(2)
      if (usedPaths.has(path)) fail(`Duplicate Entry reference ${attrs.src}`, line)
      usedPaths.add(path)
      try { node = readEntry(path) }
      catch (error) { return fail(error instanceof Error ? error.message : String(error), line) }
    } else {
      if (!attrs.id || attrs.name === undefined) fail(`${tag} requires id and name`, line)
      if (ids.has(attrs.id!)) fail(`Duplicate node ID ${attrs.id}`, line)
      if (tag === 'Slot' && children.length) fail('Slot cannot contain children', line)
      const properties = Object.hasOwn(metadata, attrs.id!) ? metadata[attrs.id!]! : {}
      for (const key of ['id', 'kind', 'label', 'children', 'enabled', 'category', 'meta']) if (key in properties) fail(`${key} is owned by composition.xml`, line)
      if (properties.capabilities !== undefined && (!properties.capabilities || typeof properties.capabilities !== 'object' || Array.isArray(properties.capabilities))) fail('Expected capabilities object', line)
      const capabilities = { ...properties.capabilities as Record<string, never> }
      if (tag === 'Message') {
        if (!['system', 'user', 'assistant'].includes(attrs.role ?? '')) fail('Message requires role system, user or assistant', line)
        if ('roleHint' in capabilities) fail('roleHint is owned by Message role', line)
      }
      if (tag === 'Slot' && 'targetAnchorId' in capabilities) fail('targetAnchorId is owned by Slot anchor', line)
      if (attrs.enabled !== undefined && attrs.enabled !== 'true' && attrs.enabled !== 'false') fail('enabled must be true or false', line)
      usedMetadata.add(attrs.id!)
      node = { ...properties,
        ...(attrs.enabled !== undefined ? { enabled: attrs.enabled === 'true' } : {}),
        ...(attrs.category !== undefined ? { category: attrs.category } : {}),
        ...(attrs.meta !== undefined ? { meta: attrs.meta } : {}), id: attrs.id!, label: attrs.name!, kind: tag === 'Message' ? 'message' : tag === 'Group' ? 'folder' : 'virtual',
        ...(Object.keys(capabilities).length || tag === 'Message' || attrs.anchor !== undefined ? { capabilities: { ...capabilities,
          ...(tag === 'Message' ? { roleHint: attrs.role! } : {}), ...(attrs.anchor !== undefined ? { targetAnchorId: attrs.anchor } : {}) } } : {}),
      } as AuthoringNode
    }
    if (ids.has(node.id)) fail(`Duplicate node ID ${node.id}`, line)
    ids.add(node.id)
    if (tag === 'Message' || tag === 'Group') node.children = children.map(visit)
    return node
  }
  const nodes = root!.children.map(visit)
  for (const id of Object.keys(metadata)) if (!usedMetadata.has(id)) fail(`Unreferenced compositionMetadata: ${id}`)
  return nodes
}
