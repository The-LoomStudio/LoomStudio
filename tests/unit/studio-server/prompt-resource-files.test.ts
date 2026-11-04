import { describe, expect, it } from 'vitest'
import { projectPromptResourceFiles, restorePromptResourceFiles, loadPromptResourceFiles } from '../../../apps/studio-server/src/codecs/prompt-resource-files.js'
import { decodePromptResourceZip, encodePromptResourceZip } from '../../../apps/studio-server/src/codecs/prompt-resource-zip.js'
import { unzipSync, zipSync } from 'fflate'

const artifact = {
  format: 'loom.promptResource' as const, schemaVersion: 2 as const, resourceKind: 'prompt' as const,
  macros: { test: 'value' }, useCardLore: true,
  rootNode: { id: 'root/unsafe-path', kind: 'module' as const, label: '测试', body: '', children: [
    { id: 'second', kind: 'text' as const, label: 'Second', body: '# Markdown\n\n中文\n' },
    { id: 'first', kind: 'text' as const, label: 'First', body: 'unchanged' },
  ] },
}

describe('Prompt Resource files', () => {
  it('preserves IDs, order, empty bodies and metadata with editable Markdown', async () => {
    const files: Record<string, Uint8Array> = {}
    const index = projectPromptResourceFiles(artifact, files)
    expect(restorePromptResourceFiles(index, new Map(Object.entries(files)))).toEqual(artifact)
    expect(files['entries/0/0.md']).toEqual(new TextEncoder().encode('# Markdown\n\n中文\n'))
    files['entries/0/0.md'] = new TextEncoder().encode('edited')
    const restored = await loadPromptResourceFiles(index, async path => files[path]!)
    expect(restored).toMatchObject({ rootNode: { children: [{ id: 'second', body: 'edited' }, { id: 'first' }] } })
  })
  it('rejects unsafe and missing body references', async () => {
    const files: Record<string, Uint8Array> = {}
    const index = projectPromptResourceFiles(artifact, files)
    expect(() => restorePromptResourceFiles(index, new Map())).toThrow('missing')
    index.rootNode.body = '../secret.md'
    await expect(loadPromptResourceFiles(index, async () => { throw new Error('must not read') })).rejects.toThrow('Unsafe')
  })
  it('writes current file indexes and rejects legacy artifact ZIPs', () => {
    const files = unzipSync(encodePromptResourceZip(artifact))
    expect(files['entries/0/0.md']).toBeDefined()
    for (const input of [artifact, { ...artifact, rootNode: { id: 'empty', kind: 'module' as const, label: 'Empty', children: [] } }]) {
      expect(decodePromptResourceZip(encodePromptResourceZip(input))).toEqual(input)
    }
    expect(() => decodePromptResourceZip(zipSync({
      'manifest.json': new TextEncoder().encode(JSON.stringify({ schema: 'loom.promptResource.zip.v1', resourceKind: 'prompt', artifactPath: 'resource.json' })),
      'resource.json': new TextEncoder().encode(JSON.stringify(artifact)),
    }))).toThrow('Invalid Prompt Resource ZIP manifest')
  })
})
