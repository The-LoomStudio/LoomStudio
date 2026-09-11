import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { zipSync } from 'fflate'
import { isPromptResourceArtifact } from '@loom-studio/application-runtime'
import type { ApplicationRuntime, PromptResourceArtifact, RuntimeRequestContext } from '@loom-studio/application-runtime'
import type { JsonValue } from '@loom-studio/shared'
import { isRecord, readString } from '../rpc/rpc-params.js'

type AgentTemplate = { id: string; name: string; presetId: string }
type ContentCatalog = {
  id: string
  version: string
  name: string
  resources: Array<{ id: string; path: string }>
  settingMounts: Array<{ presetResourceId: string; settingResourceId: string }>
  agents: AgentTemplate[]
}

export async function readOfficialContent(directory: string) {
  const root = await realpath(directory)
  const files: Record<string, Uint8Array> = {}
  let totalBytes = 0
  async function read(path: string) {
    if (isAbsolute(path) || path.includes('\\') || path.split('/').some(part => !part || part === '..' || part === '.')) {
      throw new Error(`Invalid official content path: ${path}`)
    }
    const filename = await realpath(resolve(root, path))
    const fromRoot = relative(root, filename)
    if (fromRoot === '..' || fromRoot.startsWith('../') || isAbsolute(fromRoot)) throw new Error(`Official content path escapes package: ${path}`)
    const info = await stat(filename)
    if (!info.isFile() || info.size > 4 * 1024 * 1024) throw new Error(`Official content file exceeds limit: ${path}`)
    const bytes = await readFile(filename)
    totalBytes += bytes.length
    if (bytes.length > 4 * 1024 * 1024 || totalBytes > 16 * 1024 * 1024) throw new Error('Official content package exceeds limit')
    files[path] = bytes
    return JSON.parse(bytes.toString('utf8')) as JsonValue
  }
  const raw = await read('catalog.json')
  const catalog = parseCatalog(raw)
  const resources: Array<{ id: string; artifact: PromptResourceArtifact }> = []
  for (const entry of catalog.resources) {
    if (entry.path === 'catalog.json' || Object.hasOwn(files, entry.path)) throw new Error(`Duplicate official content file: ${entry.path}`)
    const artifact = await read(entry.path)
    if (!isPromptResourceArtifact(artifact)) throw new Error(`Invalid Prompt Resource artifact: ${entry.path}`)
    if (artifact.scriptAttachments?.length) throw new Error('Official starter content cannot implicitly install executable attachments')
    resources.push({ id: entry.id, artifact })
  }
  const resourceKinds = new Map(resources.map(resource => [resource.id, resource.artifact.resourceKind]))
  for (const mount of catalog.settingMounts) {
    if (resourceKinds.get(mount.presetResourceId) !== 'preset' || resourceKinds.get(mount.settingResourceId) !== 'setting') {
      throw new Error('Official content has an unresolved Setting mount')
    }
  }
  for (const agent of catalog.agents) {
    if (resourceKinds.get(agent.presetId) !== 'preset') throw new Error(`Agent template preset is missing: ${agent.id}`)
  }
  const hash = createHash('sha256')
  for (const path of Object.keys(files).sort()) {
    const bytes = files[path]!
    hash.update(JSON.stringify([path, bytes.length])).update(bytes)
  }
  return { catalog, resources, digest: hash.digest('hex'), files }
}

function parseCatalog(value: JsonValue): ContentCatalog {
  if (!isRecord(value) || !Array.isArray(value.resources) || !Array.isArray(value.settingMounts) || !Array.isArray(value.agents)) {
    throw new Error('Invalid official content catalog')
  }
  const catalog = {
    id: readString(value, 'id'),
    version: readString(value, 'version'),
    name: readString(value, 'name'),
    resources: value.resources.map(item => ({ id: readString(item, 'id'), path: readString(item, 'path') })),
    settingMounts: value.settingMounts.map(item => ({
      presetResourceId: readString(item, 'presetResourceId'),
      settingResourceId: readString(item, 'settingResourceId'),
    })),
    agents: value.agents.map(item => ({ id: readString(item, 'id'), name: readString(item, 'name'), presetId: readString(item, 'presetId') })),
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(catalog.id) || !/^\d+\.\d+\.\d+$/.test(catalog.version)) throw new Error('Invalid official package identity or version')
  if (catalog.resources.length === 0 || new Set(catalog.resources.map(item => item.id)).size !== catalog.resources.length) {
    throw new Error('Official content resource IDs must be nonempty and unique')
  }
  if (new Set(catalog.agents.map(item => item.id)).size !== catalog.agents.length) throw new Error('Official Agent template IDs must be unique')
  return catalog
}

export function createOfficialContentService(runtime: ApplicationRuntime, directory: string) {
  return {
    async call(method: string, params: JsonValue | undefined, context?: RuntimeRequestContext): Promise<JsonValue> {
      const content = await readOfficialContent(directory)
      if (method === 'official.listContent') {
        const existing = await runtime.listPromptResources()
        const existingIds = new Set(existing.resources.map(resource => resource.id))
        return {
          packages: [{
            id: content.catalog.id,
            version: content.catalog.version,
            name: content.catalog.name,
            digest: content.digest,
            resources: content.resources.map(resource => ({
              id: resource.id,
              name: resource.artifact.rootNode.label,
              resourceKind: resource.artifact.resourceKind,
              available: existingIds.has(resource.id),
            })),
            agents: content.catalog.agents,
          }],
        }
      }
      if (method !== 'official.installContent' && method !== 'official.exportContent') throw new Error(`Unknown official content method: ${method}`)
      if (readString(params, 'packageId') !== content.catalog.id || readString(params, 'digest') !== content.digest) {
        throw new Error('Official package changed; refresh and confirm the current version')
      }
      if (method === 'official.exportContent') {
        return {
          fileName: `${content.catalog.id}-${content.catalog.version}.zip`,
          base64: Buffer.from(zipSync(content.files)).toString('base64'),
        }
      }
      return await runtime.installOfficialContent({
        packageId: content.catalog.id,
        packageVersion: content.catalog.version,
        resources: content.resources,
        settingMounts: content.catalog.settingMounts,
      }, context) as unknown as JsonValue
    },
  }
}
