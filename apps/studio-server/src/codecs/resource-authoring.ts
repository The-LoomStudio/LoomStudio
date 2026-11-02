import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseDocument, stringify } from 'yaml'
import { authoringNodeSchema, authoringResourceSchema, type AuthoringNode, type AuthoringResource } from '@loom-studio/shared'

import { projectPresetComposition, restorePresetComposition } from './preset-composition.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const maximumBytes = 16 * 1024 * 1024
const maximumFiles = 10_000
const roles = ['system', 'user', 'assistant']
type ObjectValue = Record<string, unknown>

function fail(path: string, message: string): never { throw new Error(`${path}: ${message}`) }
function object(value: unknown, path: string): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'Expected a YAML object')
  return value as ObjectValue
}
function assertPath(path: string) {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes(':') || path.split('/').some(part => !part || part === '.' || part === '..')) fail(path, 'Unsafe authoring path')
}
function yaml(text: string, path: string): ObjectValue {
  const document = parseDocument(text, { schema: 'core', uniqueKeys: true })
  if (document.errors.length || document.warnings.length) fail(path, [...document.errors, ...document.warnings].map(issue => issue.message).join('; '))
  let result: unknown
  try { result = document.toJS({ maxAliasCount: 0 }) } catch (error) { fail(path, String(error)) }
  return object(result, path)
}
function readText(files: ReadonlyMap<string, Uint8Array>, path: string): string {
  const bytes = files.get(path)
  if (!bytes) fail(path, 'Missing metadata file')
  try { return decoder.decode(bytes) } catch { fail(path, 'Expected UTF-8 text') }
}
function encodeLabel(label: string): string {
  // Percent encoding keeps ordinary Unicode names readable while making separators unambiguous.
  // eslint-disable-next-line no-control-regex -- Control characters are intentionally rejected or encoded in paths and CSS values.
  return label.replace(/[%./\\:*?"<>|\u0000-\u001f]/g, value => encodeURIComponent(value).replace(/\./g, '%2E'))
}
function decodeLabel(label: string, path: string): string {
  try { return decodeURIComponent(label) } catch { fail(path, 'Invalid percent escape in label') }
}
function parseNode(value: unknown, path: string): AuthoringNode {
  const result = authoringNodeSchema.safeParse(value)
  if (!result.success) fail(path, result.error.message)
  return result.data
}
function nodeMetadata(node: AuthoringNode): ObjectValue {
  const { label: _label, kind: _kind, children: _children, ...metadata } = node
  return metadata
}

/** Project a domain snapshot to an editable directory, without creating another resource package. */
export function projectResourceAuthoring(input: AuthoringResource): Map<string, Uint8Array> {
  const resource = authoringResourceSchema.parse(input)
  const files = new Map<string, Uint8Array>()
  const put = (path: string, value: string) => files.set(path, encoder.encode(value))
  const { children: _children, ...rootNode } = resource.rootNode
  if (resource.resourceKind === 'preset') {
    const composition = projectPresetComposition(resource.rootNode.children ?? [], (node, index) => {
      const path = `${String((index + 1) * 10).padStart(3, '0')}-${encodeLabel(node.label)}.md`
      const { body: _body, ...header } = nodeMetadata(node)
      put(path, `---\n${stringify(header)}---\n${node.body ?? ''}`)
      return path
    })
    put('composition.xml', composition.xml)
    put('resource.yaml', stringify({ ...resource, rootNode,
      ...(Object.keys(composition.metadata).length ? { compositionMetadata: composition.metadata } : {}) }))
    return files
  }
  put('resource.yaml', stringify({ ...resource, rootNode }))
  const visit = (nodes: AuthoringNode[], parent: string) => {
    nodes.forEach((node, index) => {
      const prefix = `${parent}${String((index + 1) * 10).padStart(3, '0')}-${encodeLabel(node.label)}`
      const metadata = nodeMetadata(node)
      if (node.kind === 'entry') {
        const { body: _body, ...header } = metadata
        put(`${prefix}.md`, `---\n${stringify(header)}---\n${node.body ?? ''}`)
      } else if (node.kind === 'virtual') {
        put(`${prefix}.anchor.yaml`, stringify(metadata))
      } else if (node.kind === 'folder' || node.kind === 'message') {
        let directory = prefix
        if (node.kind === 'message') {
          const role = node.capabilities?.roleHint === 'developer' ? 'system' : node.capabilities?.roleHint ?? 'system'
          if (typeof role !== 'string' || !roles.includes(role)) fail(prefix, `Unsupported Message role: ${String(role)}`)
          directory += `.${role}.message`
          const { roleHint: _role, ...capabilities } = node.capabilities ?? {}
          if (Object.keys(capabilities).length) metadata.capabilities = capabilities
          else delete metadata.capabilities
        }
        put(`${directory}/${node.kind === 'message' ? 'message' : 'folder'}.yaml`, stringify(metadata))
        visit(node.children ?? [], `${directory}/`)
      } else fail(prefix, `Unsupported nested node kind: ${node.kind}`)
    })
  }
  visit(resource.rootNode.children ?? [], '')
  return files
}

/** All paths are relative to one resource directory. Root .loom state is not author content. */
export function restoreResourceAuthoring(input: ReadonlyMap<string, Uint8Array>): AuthoringResource {
  const files = new Map<string, Uint8Array>()
  let bytes = 0
  for (const [path, content] of input) {
    assertPath(path)
    if (path.startsWith('.loom/')) continue
    bytes += content.byteLength
    if (bytes > maximumBytes || files.size >= maximumFiles) fail(path, 'Authoring directory exceeds limits')
    if (path.split('/').length > 130) fail(path, 'Tree exceeds 128 levels')
    files.set(path, content)
  }
  const header = yaml(readText(files, 'resource.yaml'), 'resource.yaml')
  const root = object(header.rootNode, 'resource.yaml/rootNode')
  if ('children' in root) fail('resource.yaml/rootNode', 'Children must be represented by files')
  const used = new Set<string>(['resource.yaml'])
  const idPaths = new Map<string, string>()
  const trackId = (node: AuthoringNode, path: string) => {
    const previous = idPaths.get(node.id)
    if (previous) fail(path, `Duplicate node ID ${node.id}; also declared at ${previous}`)
    idPaths.set(node.id, path)
    return node
  }
  const readMetadata = (path: string): ObjectValue => {
    used.add(path)
    const metadata = yaml(readText(files, path), path)
    for (const key of ['kind', 'label', 'children']) if (key in metadata) fail(path, `${key} is determined by the path`)
    return metadata
  }
  const children = (parent: string, metadataName: string): AuthoringNode[] => {
    const names = new Set<string>()
    for (const path of files.keys()) {
      if (!path.startsWith(parent)) continue
      const relative = path.slice(parent.length)
      if (relative === metadataName) continue
      names.add(relative.split('/')[0])
    }
    const order = new Set<number>()
    const entries = [...names].map(name => {
      const path = `${parent}${name}`
      const match = /^(\d+)-(.*)$/.exec(name)
      if (!match) fail(path, 'Expected a numeric sibling prefix, such as 010-')
      const number = Number(match[1])
      if (!Number.isSafeInteger(number)) fail(path, 'Invalid numeric prefix')
      if (order.has(number)) fail(path, `Duplicate sibling number ${number}`)
      order.add(number)
      return { path, name: match[2], number }
    }).sort((a, b) => a.number - b.number)
    return entries.map(({ path, name }) => {
      const directory = [...files.keys()].some(candidate => candidate.startsWith(`${path}/`))
      if (directory && files.has(path)) fail(path, 'Path is both a file and a directory')
      let node: AuthoringNode
      if (directory) {
        const message = /^(.*)\.([^.]+)\.message$/.exec(name)
        const kind = message ? 'message' : 'folder'
        const filename = `${kind}.yaml`
        const metadataPath = `${path}/${filename}`
        const metadata = readMetadata(metadataPath)
        if (message) {
          const role = message[2] === 'developer' ? 'system' : message[2]
          if (!roles.includes(role)) fail(path, `Unsupported Message role: ${role}`)
          const capabilities = metadata.capabilities === undefined ? {} : object(metadata.capabilities, metadataPath)
          if ('roleHint' in capabilities) fail(metadataPath, 'Message roleHint is determined by the directory')
          metadata.capabilities = { ...capabilities, roleHint: role }
        }
        node = parseNode({ ...metadata, kind, label: decodeLabel(message ? message[1] : name, path) }, metadataPath)
        trackId(node, metadataPath)
        node.children = children(`${path}/`, filename)
        return node
      }
      if (name.endsWith('.anchor.yaml')) {
        node = parseNode({ ...readMetadata(path), kind: 'virtual', label: decodeLabel(name.slice(0, -12), path) }, path)
      } else if (name.endsWith('.md')) {
        used.add(path)
        const text = readText(files, path)
        const frontmatter = /^---\r?\n([\s\S]*?)^---\r?\n/m.exec(text)
        if (!frontmatter || frontmatter.index !== 0) fail(path, 'Expected YAML Frontmatter with a closing --- line')
        const metadata = yaml(frontmatter[1], path)
        for (const key of ['kind', 'label', 'children', 'body']) if (key in metadata) fail(path, `${key} is determined by the file`)
        node = parseNode({ ...metadata, kind: 'entry', label: decodeLabel(name.slice(0, -3), path), body: text.slice(frontmatter[0].length) }, path)
      } else fail(path, 'Unsupported authoring file')
      return trackId(node, path)
    })
  }
  const rootNode = trackId(parseNode(root, 'resource.yaml/rootNode'), 'resource.yaml/rootNode')
  if (files.has('composition.xml')) {
    if (header.resourceKind !== 'preset') fail('composition.xml', 'Only Preset supports XML composition')
    used.add('composition.xml')
    const metadata = header.compositionMetadata === undefined ? {} : object(header.compositionMetadata, 'resource.yaml/compositionMetadata')
    for (const [id, value] of Object.entries(metadata)) object(value, `resource.yaml/compositionMetadata/${id}`)
    delete header.compositionMetadata
    rootNode.children = restorePresetComposition(readText(files, 'composition.xml'), metadata as Record<string, ObjectValue>, path => {
      assertPath(path)
      if (!path.endsWith('.md')) fail(path, 'Entry must reference a Markdown file')
      const filename = path.split('/').at(-1)!
      const name = /^(\d+)-(.*)\.md$/.exec(filename)
      if (!name) fail(path, 'Expected a numeric Entry prefix, such as 010-')
      used.add(path)
      const text = readText(files, path)
      const frontmatter = /^---\r?\n([\s\S]*?)^---\r?\n/m.exec(text)
      if (!frontmatter || frontmatter.index !== 0) fail(path, 'Expected YAML Frontmatter with a closing --- line')
      const properties = yaml(frontmatter[1], path)
      for (const key of ['kind', 'label', 'children', 'body']) if (key in properties) fail(path, `${key} is determined by the file`)
      return parseNode({ ...properties, kind: 'entry', label: decodeLabel(name[2], path), body: text.slice(frontmatter[0].length) }, path)
    })
  } else rootNode.children = children('', 'resource.yaml')
  const result = authoringResourceSchema.safeParse({ ...header, rootNode })
  if (!result.success) fail('resource.yaml', result.error.message)
  for (const path of files.keys()) if (!used.has(path)) fail(path, 'Unconsumed authoring file')
  return result.data
}

export async function loadResourceAuthoring(directory: string): Promise<AuthoringResource> {
  const files = new Map<string, Uint8Array>()
  let bytes = 0
  const visit = async (relative: string, depth: number) => {
    if (depth > 128) fail(relative, 'Tree exceeds 128 levels')
    const path = join(directory, relative)
    const info = await lstat(path)
    if (info.isSymbolicLink()) fail(relative || directory, 'Symbolic links are not authoring files')
    if (info.isDirectory()) {
      const names = await readdir(path)
      if (relative && names.length === 0) fail(relative, 'Missing folder.yaml or message.yaml')
      for (const name of names) {
        if (!relative && name === '.loom') continue
        await visit(relative ? `${relative}/${name}` : name, depth + 1)
      }
    } else if (info.isFile()) {
      bytes += info.size
      if (bytes > maximumBytes || files.size >= maximumFiles) fail(relative, 'Authoring directory exceeds limits')
      files.set(relative, await readFile(path))
    } else fail(relative, 'Expected an ordinary file or directory')
  }
  await visit('', 0)
  return restoreResourceAuthoring(files)
}

export async function writeResourceAuthoring(directory: string, resource: AuthoringResource): Promise<void> {
  const files = projectResourceAuthoring(resource)
  await mkdir(directory, { recursive: true })
  const info = await lstat(directory)
  if (info.isSymbolicLink() || !info.isDirectory()) fail(directory, 'Expected an ordinary directory')
  if ((await readdir(directory)).length) fail(directory, 'Export destination must be empty')
  for (const [path, content] of files) {
    const parts = path.split('/')
    parts.pop()
    if (parts.length) await mkdir(join(directory, ...parts), { recursive: true })
    await writeFile(join(directory, path), content, { flag: 'wx' })
  }
}
