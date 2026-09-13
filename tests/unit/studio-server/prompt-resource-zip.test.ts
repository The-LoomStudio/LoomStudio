import { decodePromptResourceZip, encodePromptResourceZip } from '../../../apps/studio-server/src/codecs/prompt-resource-zip.js'
import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

const artifact = {
  format: 'loom.promptResource' as const,
  schemaVersion: 2 as const,
  resourceKind: 'prompt' as const,
  rootNode: { id: 'root', kind: 'module' as const, label: 'Root', children: [] },
}

describe('prompt resource ZIP codec', () => {
  it('round trips one Prompt Resource artifact', () => {
    expect(decodePromptResourceZip(encodePromptResourceZip(artifact))).toEqual(artifact)
  })

  it('rejects missing or invalid manifest', () => {
    expect(() => decodePromptResourceZip(zipSync({ 'resource.json': new TextEncoder().encode(JSON.stringify(artifact)) }))).toThrow('missing')
    expect(() => decodePromptResourceZip(zipSync({
      'manifest.json': new TextEncoder().encode(JSON.stringify({ schema: 'wrong', artifactPath: 'resource.json' })),
      'resource.json': new TextEncoder().encode(JSON.stringify(artifact)),
    }))).toThrow('Invalid Prompt Resource ZIP manifest')
  })

  it('rejects an artifact whose kind differs from the manifest', () => {
    const manifest = { schema: 'loom.promptResource.zip.v1', resourceKind: 'setting', artifactPath: 'resource.json' }
    expect(() => decodePromptResourceZip(zipSync({
      'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
      'resource.json': new TextEncoder().encode(JSON.stringify(artifact)),
    }))).toThrow('Invalid Prompt Resource ZIP artifact')
  })
})
