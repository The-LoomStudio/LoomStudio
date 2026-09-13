import { isPromptResourceArtifact, type PromptResourceArtifact } from '@loom-studio/application-runtime'
import { unzipSync, zipSync } from 'fflate'

const manifestPath = 'manifest.json'
const artifactPath = 'resource.json'
const maxBundleBytes = 16 * 1024 * 1024

type PromptResourceZipManifest = {
  schema: 'loom.promptResource.zip.v1'
  resourceKind: PromptResourceArtifact['resourceKind']
  artifactPath: typeof artifactPath
}

export function encodePromptResourceZip(artifact: PromptResourceArtifact): Uint8Array {
  if (!isPromptResourceArtifact(artifact)) throw new Error('Invalid Prompt Resource artifact')
  const manifest: PromptResourceZipManifest = {
    schema: 'loom.promptResource.zip.v1',
    resourceKind: artifact.resourceKind,
    artifactPath,
  }
  return zipSync({
    [manifestPath]: new TextEncoder().encode(JSON.stringify(manifest)),
    [artifactPath]: new TextEncoder().encode(JSON.stringify(artifact)),
  })
}

export function decodePromptResourceZip(source: Uint8Array): PromptResourceArtifact {
  if (source.byteLength > maxBundleBytes) throw new Error('Prompt Resource ZIP exceeds maximum size')
  const files = unzipSync(source)
  const manifestBytes = files[manifestPath]
  const artifactBytes = files[artifactPath]
  if (!manifestBytes || !artifactBytes) throw new Error('Prompt Resource ZIP is missing its manifest or resource')
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as Partial<PromptResourceZipManifest>
  if (manifest.schema !== 'loom.promptResource.zip.v1' || manifest.artifactPath !== artifactPath) {
    throw new Error('Invalid Prompt Resource ZIP manifest')
  }
  const artifact = JSON.parse(new TextDecoder().decode(artifactBytes))
  if (!isPromptResourceArtifact(artifact) || artifact.resourceKind !== manifest.resourceKind) {
    throw new Error('Invalid Prompt Resource ZIP artifact')
  }
  return artifact
}
