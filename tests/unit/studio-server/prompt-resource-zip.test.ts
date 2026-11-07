import { decodePromptResourceZip, encodePromptResourceZip } from '../../../apps/studio-server/src/codecs/prompt-resource-zip.js'
import { zipSync, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

const artifact = {
  format: 'loom.promptResource' as const,
  schemaVersion: 2 as const,
  resourceKind: 'prompt' as const,
  rootNode: { id: 'root', kind: 'module' as const, label: 'Root', children: [] },
}

describe('prompt resource ZIP codec', () => {
  it('round-trips release metadata through the ZIP manifest and preserves legacy resources', () => {
    const release = { id: 'author.fog-preset', version: '1.3.0', update: { manifestUrl: 'https://cdn.example/manifest.json' } }
    const encoded = encodePromptResourceZip({ ...artifact, metadata: { release } })
    expect(JSON.parse(new TextDecoder().decode(unzipSync(encoded)['manifest.json'])).release).toEqual(release)
    const decoded = decodePromptResourceZip(encoded)
    expect(decoded.metadata?.release).toEqual(release)
    expect(decodePromptResourceZip(encodePromptResourceZip(decoded)).metadata?.release).toEqual(release)
    expect(decodePromptResourceZip(encodePromptResourceZip(artifact)).metadata?.release).toBeUndefined()
  })

  it('rejects missing or invalid manifest', () => {
    expect(() => decodePromptResourceZip(zipSync({ 'resource.json': new TextEncoder().encode(JSON.stringify(artifact)) }))).toThrow('missing')
    expect(() => decodePromptResourceZip(zipSync({
      'manifest.json': new TextEncoder().encode(JSON.stringify({ schema: 'wrong', artifactPath: 'resource.json' })),
      'resource.json': new TextEncoder().encode(JSON.stringify(artifact)),
    }))).toThrow('Invalid Prompt Resource ZIP manifest')
  })

  it('rejects an artifact whose kind differs from the manifest', () => {
    const files = unzipSync(encodePromptResourceZip(artifact))
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify({ schema: 'loom.promptResource.zip.v2', resourceKind: 'lore', artifactPath: 'index.json' }))
    expect(() => decodePromptResourceZip(zipSync(files))).toThrow('Invalid Prompt Resource ZIP artifact')
  })
})
