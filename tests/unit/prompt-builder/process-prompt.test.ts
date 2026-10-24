import type { ObservationBuild } from '../../../packages/application-runtime/src/observability/types.js'
import { describe, expect, it, vi } from 'vitest'
import { processPrompt } from '../../../packages/application-runtime/src/prompt/process-prompt.js'
import { createPromptProcessorRegistry } from '../../../packages/application-runtime/src/prompt/prompt-processor-registry.js'
import type { PromptDataModel } from '../../../packages/application-runtime/src/prompt/prompt-build-pipeline.js'
import { compilePromptDataModel } from '../../../packages/application-runtime/src/prompt/prompt-build-pipeline.js'

function fixture(): PromptDataModel {
  return {
    skeletonRootId: 'root',
    sourceNodes: [
      { id: 'root', sourceId: 'preset', parentId: null, orderIndex: 0, displayName: 'Preset', kind: 'module' },
      { id: 'inline', sourceId: 'preset', parentId: 'root', orderIndex: 0, displayName: 'Inline', kind: 'entry', body: 'INLINE' },
      { id: 'slot', sourceId: 'preset', parentId: 'root', orderIndex: 1, displayName: 'Slot', kind: 'virtual' },
      { id: 'history', sourceId: 'preset', parentId: 'root', orderIndex: 2, displayName: 'History', kind: 'virtual' },
      { id: 'off', sourceId: 'lore', parentId: null, orderIndex: 0, displayName: 'Disabled', kind: 'entry', enabled: false },
    ],
    contributions: [
      { id: 'late', sourceRef: { kind: 'lore', sourceId: 'lore', sourceNodeId: 'late' },
        content: 'LATE', capabilities: { processorId: 'test/ejs', targetAnchorId: 'slot', localDepth: 2 } },
      { id: 'early', sourceRef: { kind: 'lore', sourceId: 'lore', sourceNodeId: 'early' },
        content: 'EARLY', capabilities: { processorId: 'test/ejs', targetAnchorId: 'slot', localDepth: 1, activation: { kind: 'manual' } } },
      { id: 'inline', sourceRef: { kind: 'preset', sourceId: 'preset', sourceNodeId: 'inline' },
        content: 'INLINE', capabilities: { processorId: 'test/ejs' } },
      { id: 'off', sourceRef: { kind: 'lore', sourceId: 'lore', sourceNodeId: 'off' },
        content: 'OFF', capabilities: { processorId: 'test/ejs', targetAnchorId: 'slot' } },
      { id: 'native', sourceRef: { kind: 'sessionHistory', sourceId: 'session', sourceNodeId: 'native' },
        content: 'SUMMARY', messages: [
          { role: 'assistant', content: null, tool_calls: [{ id: 'call', type: 'function', function: { name: 'read', arguments: '{}' } }] },
          { role: 'tool', content: '<%= untouched %>', tool_call_id: 'call' },
        ], capabilities: { targetAnchorId: 'history' } },
    ],
  }
}

const context = () => ({ mode: 'preview' as const, signal: new AbortController().signal })

describe('authored prompt processing', () => {
  it('prepares activation then renders once in DFS/anchor order, preserving native messages and inputs', async () => {
    const registry = createPromptProcessorRegistry()
    const dispose = vi.fn()
    const rendered: string[] = []
    registry.register({ id: 'test/ejs', create: () => ({
      prepare(entries) {
        expect(entries.map(entry => entry.id)).not.toContain('off')
        return [{ id: 'early', active: true }, { id: 'late', active: false }]
      },
      render(entry) { rendered.push(entry.id); return `${rendered.length}:${entry.content}` },
      dispose,
    }) })
    const input = fixture()
    // Source preparation never emits disabled contributions; exercise the public boundary as well.
    const observation: ObservationBuild = {}
    const result = await processPrompt(input, { registry, context: context(), observation })
    expect(rendered).toEqual(['inline', 'early'])
    expect(result.projection.messages.map(message => message.content)).toEqual([
      '1:INLINE\n\n2:EARLY', '', '<%= untouched %>',
    ])
    expect(result.projection.messages.at(-1)?.tool_call_id).toBe('call')
    expect(result.projection.messages.at(-2)?.tool_calls?.[0]?.id).toBe('call')
    expect(input.sourceNodes.find(node => node.id === 'inline')?.body).toBe('INLINE')
    expect(result.model.sourceNodes.find(node => node.id === 'inline')?.body).toBe('1:INLINE')
    expect(result.model.contributions.find(entry => entry.id === 'early')?.content).toBe('2:EARLY')
    expect(dispose).toHaveBeenCalledOnce()
    expect(observation.sources?.find(source => source.id === 'inline')).toMatchObject({
      original: 'INLINE', rendered: '1:INLINE', active: true, fragmentIds: ['inline'],
    })
    expect(observation.sources?.find(source => source.id === 'late')).toMatchObject({ active: false, reason: 'activation: manual' })
    expect(observation.transformations).toContainEqual(expect.objectContaining({ kind: 'processor', stage: 'prepare', entryId: 'early', active: true }))
    expect(observation.transformations).toContainEqual(expect.objectContaining({ kind: 'processor', stage: 'render', entryId: 'inline', before: 'INLINE', after: '1:INLINE' }))
    expect(observation.messageFragments).toEqual(result.projection.messages.map(message => message.fragmentIds))
  })

  it('rejects preparation patches outside the selected processor and cleans up', async () => {
    const registry = createPromptProcessorRegistry()
    const dispose = vi.fn()
    registry.register({ id: 'test/ejs', create: () => ({
      prepare: () => [{ id: 'native', content: 'corrupted' }], render: entry => entry.content, dispose,
    }) })
    const observation: ObservationBuild = {}
    await expect(processPrompt(fixture(), { registry, context: context(), observation })).rejects.toThrow('Invalid Prompt preparation patch')
    expect(observation.sources?.length).toBeGreaterThan(0)
    expect(observation.diagnostics).toContainEqual(expect.objectContaining({ code: 'prompt.processor_failed', stage: 'prepare' }))
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('does not allow processing native history, or silently send templates when the processor is absent', async () => {
    const registry = createPromptProcessorRegistry()
    await expect(processPrompt(fixture(), { registry, context: context() })).rejects.toThrow('unavailable')
    expect(() => compilePromptDataModel(fixture())).toThrow('asynchronous build path')
    const input = fixture()
    input.contributions.at(-1)!.capabilities.processorId = 'test/ejs'
    await expect(processPrompt(input, { registry, context: context() })).rejects.toThrow('only accept authored')
  })

  it('expands ordinary macros only after rendering and removes empty rendered fragments', async () => {
    const registry = createPromptProcessorRegistry()
    const renderText = vi.fn(content => content.replace('{{name}}', 'Loom'))
    registry.register({ id: 'test/ejs', create: () => ({
      render: entry => entry.id === 'inline' ? '{{name}}' : '',
    }) })
    const result = await processPrompt(fixture(), { registry, context: context(), renderText })
    expect(result.projection.messages[0]?.content).toBe('Loom')
    expect(renderText.mock.calls.map(call => call[0])).toEqual(['{{name}}', ''])
  })

  it('aborts an in-flight render on disposal and never starts the next entry', async () => {
    const registry = createPromptProcessorRegistry()
    let started!: () => void
    const entered = new Promise<void>(resolve => { started = resolve })
    const dispose = vi.fn()
    const render = vi.fn()
    const handle = registry.register({ id: 'test/ejs', create: ({ signal }) => ({
      render: () => new Promise<string>((_resolve, reject) => {
        render()
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        started()
      }),
      dispose,
    }) })
    const pending = processPrompt(fixture(), { registry, context: context() })
    const failure = expect(pending).rejects.toThrow()
    await entered
    handle.dispose()
    await failure
    expect(render).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('isolates Card-scoped registrations and allocates a new session for every build', async () => {
    const registry = createPromptProcessorRegistry()
    const create = vi.fn(() => ({ render: () => '' }))
    registry.register({ id: 'test/ejs', create }, { kind: 'card', cardId: 'a' })
    await expect(processPrompt(fixture(), { registry, context: { ...context(), cardId: 'b' } })).rejects.toThrow('unavailable')
    await processPrompt(fixture(), { registry, context: { ...context(), cardId: 'a' } })
    await processPrompt(fixture(), { registry, context: { ...context(), cardId: 'a' } })
    expect(create).toHaveBeenCalledTimes(2)
  })
})

function loreOnly() {
  const input = fixture()
  input.contributions = input.contributions.filter(entry => entry.sourceRef.kind !== 'preset')
  input.sourceNodes = input.sourceNodes.filter(node => node.id !== 'inline')
  return input
}

it('skips a missing Lore processor group with resource diagnostics and never emits its templates', async () => {
  const result = await processPrompt(loreOnly(), { registry: createPromptProcessorRegistry(), context: context() })
  expect(result.projection.messages.map(message => message.content).join(' ')).not.toMatch(/EARLY|LATE|OFF/)
  expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ resourceId: 'lore', entryId: 'late', processorId: 'test/ejs' })]))
  expect(result.diagnostics).toHaveLength(2)
})

it('isolates render failures to selected Lore entries and reports disposal failures separately', async () => {
  const registry = createPromptProcessorRegistry()
  registry.register({ id: 'test/ejs', create: () => ({
    prepare: () => [{ id: 'early', active: true }],
    render: entry => { if (entry.id === 'late') throw new Error('bad template'); return 'GOOD' },
    dispose: () => { throw new Error('cleanup failed') },
  }) })
  const result = await processPrompt(loreOnly(), { registry, context: context() })
  expect(result.projection.messages.map(message => message.content).join(' ')).toContain('GOOD')
  expect(result.projection.messages.map(message => message.content).join(' ')).not.toContain('LATE')
  expect(result.diagnostics.map(item => item.code)).toEqual(['prompt.processor_entry_skipped', 'prompt.processor_cleanup_failed'])
})

it('keeps a Preset failure as the primary cause when cleanup also fails', async () => {
  const registry = createPromptProcessorRegistry()
  registry.register({ id: 'test/ejs', create: () => ({ render: () => { throw new Error('primary template error') }, dispose: () => { throw new Error('cleanup error') } }) })
  await expect(processPrompt(fixture(), { registry, context: context() })).rejects.toMatchObject({
    message: expect.stringContaining('primary template error'),
    cause: expect.objectContaining({ message: expect.stringContaining('preset/inline') }),
    errors: expect.arrayContaining([expect.objectContaining({ message: 'cleanup error' })]),
  })
})

it.each([
  Object.assign(new Error('denied'), { code: 'state.permission_denied' }),
  new DOMException('cancelled', 'AbortError'),
  new Error('Extension instance test was not granted assets.read'),
])('does not downgrade permission or cancellation errors to optional Lore warnings', async error => {
  const registry = createPromptProcessorRegistry()
  registry.register({ id: 'test/ejs', create: () => { throw error } })
  await expect(processPrompt(loreOnly(), { registry, context: context() })).rejects.toBe(error)
})

it('discards the whole Lore group when batch preparation returns a partially invalid result', async () => {
  const registry = createPromptProcessorRegistry()
  const render = vi.fn(() => 'must not render')
  registry.register({ id: 'test/ejs', create: () => ({ prepare: () => [{ id: 'late', content: 'partial' }, { id: 'foreign', active: true }], render }) })
  const result = await processPrompt(loreOnly(), { registry, context: context() })
  expect(render).not.toHaveBeenCalled()
  expect(result.diagnostics).toHaveLength(2)
  expect(result.model.contributions.find(item => item.id === 'late')?.content).toBe('LATE')
})
