import { describe, expect, it } from 'vitest'
import { compareMessages } from '../../../apps/studio-client/src/widgets/observability-workbench/observation-message-diff.js'
import { buildSourceTree } from '../../../apps/studio-client/src/widgets/observability-workbench/observation-source-tree.js'
import { mapObservationStep } from '../../../apps/studio-client/src/features/observability/model/observation-mapping.js'
import type { ObservationSource } from '../../../apps/studio-client/src/widgets/observability-workbench/observation-view.js'
import type { ObservationEntry } from '../../../apps/studio-client/src/entities/observation.js'

const message = (content: string, role = 'user') => ({ role, content })
const source = (id: string, extra: Partial<ObservationSource> = {}): ObservationSource => ({ id, title: id, path: '', active: false, included: false, reason: '', original: '', rendered: '', ...extra })

describe('model log reading', () => {
  it('aligns an insertion without marking the following messages edited', () => {
    const before = [message('policy', 'system'), message('hello'), message('response', 'assistant')]
    const delta = compareMessages(before, [before[0], message('context', 'system'), ...before.slice(1)])
    expect([...delta.changes]).toEqual([[1, 'added']])
    expect(delta.removed).toEqual([])
  })
  it('reports removed context and retains exact repeated messages', () => {
    const before = [message('expired', 'system'), message('same'), message('same')]
    const delta = compareMessages(before, before.slice(1))
    expect([...delta.changes]).toEqual([])
    expect(delta.removed).toEqual([0])
  })
  it('retains the repeated suffix when earlier repeated context is removed', () => {
    const before = [message('same'), message('middle'), message('same')]
    const delta = compareMessages(before, before.slice(1))
    expect([...delta.changes]).toEqual([])
    expect(delta.removed).toEqual([0])
  })
  it('marks an edited gap without shifting subsequent tool results', () => {
    const before = [message('old', 'system'), { ...message('done', 'tool'), tool_call_id: 'call-1' }]
    const delta = compareMessages(before, [message('new', 'system'), before[1]])
    expect([...delta.changes]).toEqual([[0, 'changed']])
  })
  it('keeps real source hierarchy and unused siblings inside their anchor', () => {
    const tree = buildSourceTree([
      source('anchor', { nodeKind: 'virtual', title: 'Readable anchor name', anchorIds: ['anchor', '@lore.stable'] }),
      source('book', { nodeKind: 'module' }),
      source('folder', { nodeKind: 'folder', parentId: 'book' }),
      source('used', { parentId: 'folder', included: true, injections: [{ id: 'e', targetAnchorId: 'anchor', rendered: 'text' }] }),
      source('unused', { parentId: 'folder', targetAnchorIds: ['@lore.stable'] }),
    ], 'Other')
    expect(tree).toHaveLength(1)
    expect(tree[0].count).toBe(1)
    expect(tree[0].title).toBe('@lore.stable')
    expect(tree[0].children[0].source?.id).toBe('book')
    const entries = tree[0].children[0].children[0].children
    expect(entries.map(node => [node.source?.id, node.included])).toEqual([['used', true], ['unused', false]])
  })
  it('keeps preset entries and nested anchors in authored order above injected resources', () => {
    const tree = buildSourceTree([
      source('preset', { nodeKind: 'module', orderIndex: 0 }),
      source('after', { nodeKind: 'entry', parentId: 'preset', orderIndex: 2, included: true }),
      source('message', { nodeKind: 'message', parentId: 'preset', orderIndex: 1 }),
      source('slot', { nodeKind: 'virtual', parentId: 'message', orderIndex: 1, anchorIds: ['@lore.stable'] }),
      source('close', { nodeKind: 'entry', parentId: 'message', orderIndex: 2, included: true }),
      source('open', { nodeKind: 'entry', parentId: 'message', orderIndex: 0, included: true }),
      source('before', { nodeKind: 'entry', parentId: 'preset', orderIndex: 0, included: true }),
      source('book', { nodeKind: 'module', orderIndex: 1 }),
      source('used', { nodeKind: 'entry', parentId: 'book', included: true, injections: [{ id: 'e', targetAnchorId: '@lore.stable', rendered: 'Lore' }] }),
      source('unused', { nodeKind: 'entry', parentId: 'book', targetAnchorIds: ['@lore.stable'] }),
    ], 'Other')
    expect(tree.map(node => node.source?.id)).toEqual(['preset'])
    expect(tree[0].children.map(node => node.source?.id)).toEqual(['before', 'message', 'after'])
    const children = tree[0].children[1].children
    expect(children.map(node => node.source?.id)).toEqual(['open', 'slot', 'close'])
    expect(children[1].title).toBe('@lore.stable')
    expect(children[1].children[0].source?.id).toBe('book')
    expect(children[1].children[0].children.map(node => [node.source?.id, node.included])).toEqual([['used', true], ['unused', false]])
    expect(tree[0].count).toBe(5)
  })
  it('keeps the captured hierarchy and sequence for older snapshots without sorting fields', () => {
    const tree = buildSourceTree([
      source('preset', { nodeKind: 'module' }),
      source('before', { nodeKind: 'entry', parentId: 'preset', included: true }),
      source('slot', { nodeKind: 'virtual', parentId: 'preset' }),
      source('after', { nodeKind: 'entry', parentId: 'preset', included: true }),
      source('injected', { included: true, injections: [{ id: 'e', targetAnchorId: 'slot', rendered: 'Lore' }] }),
    ], 'Other')
    expect(tree[0].children.map(node => node.source?.id)).toEqual(['before', 'slot', 'after'])
  })
  it('retains a multi-anchor contribution in both recorded targets', () => {
    const tree = buildSourceTree([
      source('a', { nodeKind: 'virtual' }), source('b', { nodeKind: 'virtual' }),
      source('entry', { included: true, injections: [{ id: 'one', targetAnchorId: 'a', rendered: 'A' }, { id: 'two', targetAnchorId: 'b', rendered: 'B' }] }),
    ], 'Other')
    expect(tree.map(node => [node.id, node.count])).toEqual([['a', 1], ['b', 1]])
  })
  it('does not promote an active entry with no emitted content', () => {
    const tree = buildSourceTree([source('a', { nodeKind: 'virtual' }), source('empty', { active: true, included: false, targetAnchorIds: ['a'] })], 'Other')
    expect(tree[0].included).toBe(false)
    expect(tree[0].count).toBe(0)
  })
  it('maps structured tool input and per-fragment messages without losing historical content', () => {
    const entry: ObservationEntry = {
      id: 'request', kind: 'request', title: '', status: 'completed', capturedAt: '', updatedAt: '', expiresAt: '', availability: 'recorded', buildId: 'build', providerStep: 2,
      output: { toolNames: ['codeact_json'], hasText: true },
      request: { toolExecutions: [{ id: 'tool', name: 'codeact_json', input: { arguments: { code: 'print(1)' } }, status: 'completed' }] },
    }
    const build: ObservationEntry = { ...entry, id: 'build', kind: 'build', build: {
      sources: [{ id: 'entry', title: 'History', active: true, reason: '', fragmentIds: ['f'] }],
      transformations: [{ kind: 'emission', sourceNodeId: 'entry', fragmentId: 'f', targetAnchorId: 'a', rendered: '', messages: [{ role: 'user', content: 'historical message' }] }],
    } }
    const view = mapObservationStep(entry, entry, build)
    expect(view.title).toContain('codeact_json')
    expect(view.title).toContain('输出文本')
    expect(view.tools[0].input).toEqual(entry.request!.toolExecutions![0].input)
    expect(view.sources[0].injections?.[0].rendered).toBe('historical message')
    expect(view.canCompare).toBe(false)
  })
  it('shows macro reads only from sources with emitted content, including shared macro consumers', () => {
    const entry: ObservationEntry = { id: 'build', kind: 'build', title: '', status: 'completed', capturedAt: '', updatedAt: '', expiresAt: '', availability: 'recorded', build: {
      sources: [
        { id: 'used', title: 'Used', active: true, reason: '', fragmentIds: ['f'] },
        { id: 'inactive', title: 'Inactive', active: false, reason: '' },
        { id: 'empty', title: 'Empty', active: true, reason: '' },
      ],
      transformations: [{ kind: 'emission', sourceNodeId: 'emitted', fragmentId: 'e', rendered: 'Actual' }],
      variables: ['used', 'inactive', 'empty', 'emitted', 'missing', undefined].map(hostId => ({ name: 'char', path: 'char.name', source: 'character', hostId, value: hostId ?? 'unknown' })),
    } }
    expect(mapObservationStep(entry, entry).variables.map(read => read.hostId)).toEqual(['used', 'emitted'])
    expect(entry.build!.variables).toHaveLength(6)
  })
  it('shows a first request tool call without requiring a previous request', () => {
    const entry: ObservationEntry = { id: 'first', kind: 'request', title: '', status: 'completed', capturedAt: '', updatedAt: '', expiresAt: '', availability: 'recorded', providerStep: 1,
      request: { assistantContent: '', messages: [{ role: 'user', content: 'hello' }], response: { message: { role: 'assistant', content: '', tool_calls: [{ id: 'call', function: { name: 'codeact_json', arguments: '{"code":"print(1)"}' } }] } } } }
    const step = mapObservationStep(entry, entry)
    expect(step.canCompare).toBe(false)
    expect(step.tools[0].name).toBe('codeact_json')
    expect(step.response).toBeUndefined()
    expect(step.outputRecorded).toBe(true)
  })
  it('does not present CodeAct transport or previous tool results as Assistant Content', () => {
    const entry: ObservationEntry = { id: 'tool', kind: 'request', title: '', status: 'completed', capturedAt: '', updatedAt: '', expiresAt: '', availability: 'recorded',
      request: { assistantContent: '', messages: [{ role: 'tool', tool_call_id: 'previous', content: 'prior result' }], response: { message: { role: 'assistant', content: '<loom_tool name="codeact">code</loom_tool>' } }, toolExecutions: [{ id: 'call', name: 'codeact', input: { rawInput: 'print(1)' }, result: { content: [{ type: 'text', text: 'result' }] }, status: 'completed' }] } }
    expect(mapObservationStep(entry, entry).response).toBeUndefined()
    entry.request!.assistantContent = 'Here is the answer.'
    const step = mapObservationStep(entry, entry)
    expect(step.response?.content).toBe('Here is the answer.')
    expect(step.messages[0].role).toBe('tool')
    expect(step.tools[0].result).toEqual(entry.request!.toolExecutions![0].result)
  })

})
