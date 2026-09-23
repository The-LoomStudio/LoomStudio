import { describe, expect, it } from 'vitest'
import { vfsPath } from '../../../packages/application-runtime/src/vfs/read.js'
import { createPromptVfsEntries } from '../../../packages/application-runtime/src/vfs/vfs-gateway.js'
import { createResourceVfs } from '../../../packages/application-runtime/src/vfs/resource-filesystem.js'

const controls = [...Array.from({ length: 32 }, (_, code) => String.fromCharCode(code)), String.fromCharCode(127)]
const allowed = [' ', '%', '@', String.fromCharCode(128), String.fromCharCode(159), '中', '😀', '\ud800']

describe('VFS control character boundaries', () => {
  it('rejects every C0/DEL path character without rejecting C1 or other existing legal characters', () => {
    for (const char of controls) {
      expect(() => vfsPath(`/before${char}after`)).toThrow(expect.objectContaining({ code: 'vfs.invalid_path' }))
    }
    for (const char of allowed) expect(vfsPath(`/before${char}after`)).toBe(`/before${char}after`)
    expect(vfsPath('/')).toBe('/')
    expect(vfsPath('/folder/')).toBe('/folder')
    for (const path of ['/a\\b', '/a//b', '/a/../b', '/a/./b', 'relative']) {
      expect(() => vfsPath(path)).toThrow(expect.objectContaining({ code: 'vfs.invalid_path' }))
    }
  })

  it('replaces only path separators and C0/DEL in projected names, retaining normalization and fallback names', () => {
    const cases: Array<[string, string]> = [
      ...[...controls, '/', '\\'].map((char): [string, string] => [`before${char}after`, 'before_after']),
      ...allowed.map((char): [string, string] => [`before${char}after`, `before${char}after`]),
      [' e\u0301 ', 'é'], ['', 'untitled'], ['.', 'untitled'], ['..', 'untitled'],
    ]
    for (const [displayName, expected] of cases) {
      const entries = createPromptVfsEntries({
        prompt: { messages: [], editorProjection: { sourceRows: [], promptRows: [] } },
        sourceNodes: [{ id: 'node', sourceId: 'resource', parentId: null, displayName, kind: 'entry', orderIndex: 0 }],
        contributions: [{
          id: 'contribution', sourceRef: { kind: 'preset', sourceId: 'resource', sourceNodeId: 'node' },
          content: 'Body', capabilities: {},
        }],
      })
      expect(entries.find(entry => entry.kind === 'file')?.path).toBe(`/context/${expected}.md`)
    }
  })

  it('percent-encodes reserved/control attachment names and still reads the exact file', async () => {
    const cases: Array<[string, string]> = [
      ...controls.map((char): [string, string] => [
        `before${char}after`, `before%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}after`,
      ]),
      ['%/\\@', '%25%2F%5C%40'],
      ['', '%00'], ['.', '%2E'], ['..', '%2E%2E'], ['e\u0301', 'é'],
      ...allowed.filter(char => char !== '%' && char !== '@').map((char): [string, string] => [`before${char}after`, `before${char}after`]),
    ]
    const signal = new AbortController().signal
    for (const [name, expected] of cases) {
      const fs = createResourceVfs({
        projections: [],
        attachments: async () => [{
          identity: 'attachment', name, binding: { kind: 'script', documentId: 'script', version: 1 },
          read: async () => 'Exact attachment body',
        }],
      })
      expect(await fs.ls(['/attachments'], signal)).toContain(`  ${expected}`)
      expect(await fs.read([`/attachments/${expected}`], signal)).toMatchObject({
        text: 'Exact attachment body',
        observation: {
          path: `/attachments/${expected}`,
          binding: { kind: 'script', documentId: 'script', version: 1 },
        },
      })
    }
  })
})
