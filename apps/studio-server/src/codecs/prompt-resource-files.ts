import type { JsonValue } from '@loom-studio/shared'
import { isPromptResourceArtifact, type PromptResourceArtifact, type PromptResourceNode } from '@loom-studio/application-runtime/artifacts'
import { validateBundlePath } from './card-bundle-files.js'

type FileNode = { metadata: Omit<PromptResourceNode, 'body' | 'children'>; body?: string; children?: FileNode[] }
export type PromptResourceFilesIndex = {
  schema: 'loom.promptResource.files.v1'
  artifact: Omit<PromptResourceArtifact, 'rootNode'>
  rootNode: FileNode
}

export function projectPromptResourceFiles(artifact: PromptResourceArtifact, files: Record<string, Uint8Array>): PromptResourceFilesIndex {
  if (!isPromptResourceArtifact(artifact)) throw new Error('Invalid Prompt Resource artifact')
  const node = (value: PromptResourceNode, path: string, depth = 0): FileNode => {
    if (depth > 128) throw new Error('Prompt Resource tree exceeds 128 levels')
    const { body, children, ...metadata } = value
    if (body !== undefined) files[`${path}.md`] = new TextEncoder().encode(body)
    return { metadata, ...(body !== undefined ? { body: `${path}.md` } : {}),
      ...(children !== undefined ? { children: children.map((child, index) => node(child, `${path}/${index}`, depth + 1)) } : {}) }
  }
  const { rootNode, ...metadata } = artifact
  return { schema: 'loom.promptResource.files.v1', artifact: metadata, rootNode: node(rootNode, 'entries/0') }
}

export function isPromptResourceFilesIndex(value: unknown): value is PromptResourceFilesIndex {
  return typeof value === 'object' && value !== null && 'schema' in value && value.schema === 'loom.promptResource.files.v1'
}

export function promptResourceFileReferences(index: PromptResourceFilesIndex): string[] {
  const paths: string[] = []
  const visit = (node: FileNode, depth = 0) => {
    if (depth > 128) throw new Error('Prompt Resource tree exceeds 128 levels')
    if (!node || typeof node !== 'object' || !node.metadata || typeof node.metadata !== 'object') throw new Error('Invalid Prompt Resource file node')
    if (node.body !== undefined) { validateBundlePath(node.body); paths.push(node.body) }
    if (node.children !== undefined) {
      if (!Array.isArray(node.children)) throw new Error('Invalid Prompt Resource children')
      node.children.forEach(child => visit(child, depth + 1))
    }
  }
  visit(index.rootNode)
  return paths
}

export function restorePromptResourceFiles(index: PromptResourceFilesIndex, files: Map<string, Uint8Array>): PromptResourceArtifact {
  promptResourceFileReferences(index)
  const node = (value: FileNode): PromptResourceNode => {
    let body: string | undefined
    if (value.body !== undefined) {
      const bytes = files.get(value.body)
      if (!bytes) throw new Error(`Prompt Resource is missing ${value.body}`)
      body = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    }
    return { ...value.metadata, ...(body !== undefined ? { body } : {}),
      ...(value.children !== undefined ? { children: value.children.map(node) } : {}) }
  }
  const artifact = { ...index.artifact, rootNode: node(index.rootNode) }
  if (!isPromptResourceArtifact(artifact)) throw new Error('Invalid Prompt Resource artifact')
  return artifact
}

export async function loadPromptResourceFiles(value: JsonValue, load: (path: string) => Promise<Uint8Array>): Promise<JsonValue> {
  if (!isPromptResourceFilesIndex(value)) return value
  const files = new Map<string, Uint8Array>()
  let bytes = 0
  for (const path of new Set(promptResourceFileReferences(value))) {
    const content = await load(path)
    bytes += content.byteLength
    if (bytes > 16 * 1024 * 1024) throw new Error('Prompt Resource exceeds maximum size')
    files.set(path, content)
  }
  return restorePromptResourceFiles(value, files) as unknown as JsonValue
}
