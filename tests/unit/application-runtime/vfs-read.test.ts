import { describe, expect, it } from 'vitest'
import { createPromptVfsEntries } from '../../../packages/application-runtime/src/vfs/vfs-gateway.js'
import { listVfs, readVfs, searchVfs } from '../../../packages/application-runtime/src/vfs/read.js'
import type { VfsEntry } from '../../../packages/application-runtime/src/vfs/types.js'
import { createCodeActContext } from '../../../packages/application-runtime/src/agents/codeact/context.js'
import type { ToolExecutionScope } from '../../../packages/application-runtime/src/agents/tool-registry.js'

const files: VfsEntry[] = [
  { path: '/', kind: 'directory' },
  { path: '/alice', kind: 'directory' },
  { path: '/alice/setting.md', kind: 'file', state: 'injected', content: 'Alice\nThe key belongs to C.\nKeep the gate closed.' },
]

describe('CodeAct read-only VFS', () => {
  it.each([
    { kind: 'prompt-resource' as const, resourceId: 'resource', nodeId: 'node', version: 1, field: 'body' as const },
    { kind: 'state' as const, target: { scope: 'global' as const }, revisionId: 'revision', pointer: '/gold' },
    { kind: 'script' as const, documentId: 'document', version: 1, blobId: 'blob', mountId: 'mount' },
  ])('returns only path, range and snippet for bound $kind search results', binding => {
    const result = searchVfs([
      files[0]!, files[1]!, { ...files[2]!, binding },
    ], [{ path: '/alice', terms: ['key'] }])
    expect(result).toBe('Scope: /alice\n/alice/setting.md:1-3\n1: Alice\n2: The key belongs to C.\n3: Keep the gate closed.')
    expect(result).not.toContain('Reference:')
    expect(result).not.toContain('loom-resource:')
  })

  it('preserves a URI that is part of the source text instead of stripping source content', () => {
    const uri = 'loom-resource://entity?type=resource&id=author-example'
    const result = searchVfs([
      files[0]!, files[1]!, { ...files[2]!, content: `Original link: ${uri}` },
    ], [{ path: '/alice', terms: ['Original link'] }])
    expect(result).toContain(`1: Original link: ${uri}`)
  })

  it('lists one level and returns pure text with a separate read observation', () => {
    expect(listVfs(files, ['/'])).toBe('/\n  alice/')
    expect(listVfs(files, ['/alice'])).toBe('/alice\n  setting.md [injected]')
    expect(readVfs(files, ['/alice/setting.md', { startLine: 2, endLine: 2 }])).toEqual({
      text: 'The key belongs to C.',
      observation: { path: '/alice/setting.md', startLine: 2, endLine: 2, totalLines: 3 },
    })
    expect(searchVfs(files, [{ path: '/alice', terms: ['key', 'C.'] }]))
      .toContain('/alice/setting.md:1-3\n1: Alice\n2: The key belongs to C.')
  })

  it('rejects traversal, missing paths and invalid arguments without searching elsewhere', () => {
    expect(() => readVfs(files, ['/alice/../private'])).toThrow(/absolute virtual path/)
    expect(() => searchVfs(files, [{ path: '/history', terms: ['key'] }])).toThrow(/Path unavailable/)
    expect(() => readVfs(files, ['/alice/setting.md', { startLine: 0 }])).toThrow(/integer/)
    expect(() => searchVfs(files, [{ terms: ['key'], match: 'semantic' }])).toThrow(/all or any/)
  })

  it('marks truncated reads and search snippets explicitly', () => {
    const entries = [...files, { path: '/large.md', kind: 'file' as const, content: Array(1000).fill('line with enough text').join('\n') }]
    const read = readVfs(entries, ['/large.md'])
    expect(read.observation.endLine).toBeLessThan(read.observation.totalLines)
    expect(read.text.length).toBeLessThanOrEqual(16384)
    expect(() => readVfs([{ path: '/one.md', kind: 'file', content: 'a'.repeat(20000) }], ['/one.md']))
      .toThrow(/line exceeds/)
  })

  it('disambiguates labels and only mounts preset/setting contributions', () => {
    const entries = createPromptVfsEntries({
      prompt: { messages: [], editorProjection: { sourceRows: [], promptRows: [] } },
      sourceNodes: [
        { id: 'root', sourceId: 's', parentId: null, displayName: 'World', kind: 'module', orderIndex: 0 },
        ...['a', 'b', 'session', 'narrative', 'disabled'].map((id, orderIndex) => ({
          id, sourceId: 's', parentId: 'root', displayName: 'Same', kind: 'entry', orderIndex,
          enabled: id !== 'disabled',
        })),
      ],
      contributions: ['a', 'b', 'session', 'narrative', 'disabled'].map(id => ({
        id,
        sourceRef: { kind: id === 'session' ? 'sessionHistory' as const
          : id === 'narrative' ? 'narrativeHistory' as const : 'settingLayer' as const, sourceId: 's', sourceNodeId: id },
        content: id, capabilities: {},
      })),
    })
    const mounted = entries.filter(entry => entry.kind === 'file')
    expect(mounted).toHaveLength(2)
    expect(new Set(mounted.map(entry => entry.path)).size).toBe(2)
    expect(mounted.map(entry => readVfs(entries, [entry.path]).text)).toEqual(['a', 'b'])
    expect(entries.some(entry => entry.content === 'session' || entry.content === 'narrative')).toBe(false)
  })

  it('reads only the host supplied State target and checks permission on each operation', async () => {
    let allowed = true
    let reads = 0
    const target = { scope: 'timeline' as const, timelineId: 't', branchId: 'b' }
    const scope: ToolExecutionScope = {
      context: [], vfs: files,
      state: {
        defaultTarget: target,
        canAccess: requested => allowed && requested === target,
        read: async requested => {
          expect(requested).toBe(target)
          reads++
          return { revisionId: 'r1', value: { gold: 10 } }
        },
        update: async () => { throw new Error('Read-only CodeAct must not write.') },
      },
    }
    const ctx = createCodeActContext(scope)
    const signal = new AbortController().signal
    expect(await ctx.methods.ls!(['/'], signal)).toContain('state/')
    expect(reads).toBe(0)
    expect(await ctx.methods.read!(['/state/current.yaml'], signal)).toBe('gold: 10\n')
    allowed = false
    await expect(ctx.methods.read!(['/state/current.yaml'], signal)).rejects.toThrow(/Path unavailable/)
    expect(reads).toBe(1)
    expect(Object.keys(ctx.methods)).toEqual([
      'setAuthorMode', 'ls', 'search', 'read', 'write', 'patch', 'move', 'delete', 'create', 'copy', 'readNarrative', 'appendNarrative',
    ])
    allowed = true
    await expect(ctx.methods.write!(['/state/current.yaml', '{}'], signal))
      .rejects.toMatchObject({ code: 'vfs.write_unsupported' })
    await expect(ctx.methods.readNarrative!([
      { selection: { kind: 'tail', count: 1 } },
    ], signal)).rejects.toMatchObject({ code: 'codeact.narrative_unavailable' })
  })
})
