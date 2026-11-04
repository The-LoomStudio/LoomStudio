import type { PromptResourceArtifact } from '@loom-studio/application-runtime/artifacts'
import { unzipSync, zipSync } from 'fflate'
import { validateBundlePath } from './card-bundle-files.js'
import { isPromptResourceFilesIndex, projectPromptResourceFiles, restorePromptResourceFiles } from './prompt-resource-files.js'

const maxBundleBytes = 16 * 1024 * 1024

export function encodePromptResourceZip(artifact: PromptResourceArtifact): Uint8Array {
  const files: Record<string, Uint8Array> = Object.create(null)
  const index = projectPromptResourceFiles(artifact, files)
  files['index.json'] = new TextEncoder().encode(JSON.stringify(index, null, 2) + '\n')
  files['manifest.json'] = new TextEncoder().encode(JSON.stringify({
    schema: 'loom.promptResource.zip.v2', resourceKind: artifact.resourceKind, artifactPath: 'index.json',
  }))
  return zipSync(files)
}

export function decodePromptResourceZip(source: Uint8Array): PromptResourceArtifact {
  if (source.byteLength > maxBundleBytes) throw new Error('Prompt Resource ZIP exceeds maximum size')
  let size = 0
  const seen = new Set<string>()
  const files = unzipSync(source, { filter: entry => {
    validateBundlePath(entry.name.endsWith('/') ? entry.name.slice(0, -1) : entry.name)
    if (seen.has(entry.name)) throw new Error('Prompt Resource ZIP contains duplicate paths')
    seen.add(entry.name)
    size += entry.originalSize
    if (size > maxBundleBytes || seen.size > 10000) throw new Error('Prompt Resource ZIP exceeds maximum size')
    return true
  } })
  const manifestBytes = files['manifest.json']
  if (!manifestBytes) throw new Error('Prompt Resource ZIP is missing its manifest or resource')
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes))
  if (!(manifest.schema === 'loom.promptResource.zip.v2' && manifest.artifactPath === 'index.json')) throw new Error('Invalid Prompt Resource ZIP manifest')
  const artifactBytes = files[manifest.artifactPath]
  if (!artifactBytes) throw new Error('Prompt Resource ZIP is missing its manifest or resource')
  const stored = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(artifactBytes))
  if (!isPromptResourceFilesIndex(stored)) throw new Error('Invalid Prompt Resource ZIP artifact')
  const artifact = restorePromptResourceFiles(stored, new Map(Object.entries(files)))
  if (artifact.resourceKind !== manifest.resourceKind) throw new Error('Invalid Prompt Resource ZIP artifact')
  return artifact
}
