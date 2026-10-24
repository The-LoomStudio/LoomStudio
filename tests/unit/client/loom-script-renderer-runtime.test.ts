import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountLoomSandboxRenderer } from '../../../apps/studio-client/src/features/loom-scripts/runtime/sandbox-renderer-protocol.js'
import { createClientRendererHost } from '../../../apps/studio-client/src/shared/extension-renderer-runtime/client-renderer-host.js'
import type { ClientRendererContext } from '../../../apps/studio-client/src/shared/extension-renderer-runtime/client-renderer-host.js'
import {
  createLoomScriptRendererRuntime,
  projectLoomScriptInputs,
  type LoomScriptRendererContribution,
} from '../../../apps/studio-client/src/features/loom-scripts/runtime/loom-script-renderer-runtime.js'

vi.mock('../../../apps/studio-client/src/features/loom-scripts/runtime/sandbox-renderer-protocol.js', () => ({
  mountLoomSandboxRenderer: vi.fn(() => ({ update: vi.fn(), dispose: vi.fn() })),
}))
beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllGlobals())

const contribution: LoomScriptRendererContribution = {
  kind: 'renderer',
  renderer: { id: 'status', name: 'Status', surface: 'narrative.timeline.tail', instanceScope: 'timeline' },
  inputs: [{ kind: 'match', ruleId: 'status-rule' }, { kind: 'artifact', artifactType: 'status' }],
}

function sandboxFixture(resolveInputs: Parameters<typeof createLoomScriptRendererRuntime>[0]['resolveInputs'], requires?: string[]) {
  const rendererHost = createClientRendererHost()
  const runtime = createLoomScriptRendererRuntime({ rendererHost, resolveInputs, stateRead: vi.fn() })
  const definition = {
    mountId: 'mount', mountVersion: 1, enabled: true, orderIndex: 0, grantedCapabilities: [], source: 'export const renderers = {}',
    script: { id: 'script', version: 1, requestedCapabilities: [], contributions: [contribution], requires },
  }
  runtime.reconcile([definition])
  const registration = rendererHost.list('narrative.timeline.tail')[0]!
  const context = { scope: { kind: 'timeline', key: 'timeline' } } as ClientRendererContext
  return {
    rendererHost,
    definition,
    mount: () => registration.sandboxMount!({} as HTMLElement, context),
    runtime,
  }
}

describe('Loom Script Renderer Runtime', () => {
  it('prepares ordered classic prerequisites once per adoption and sends their source only to the sandbox', async () => {
    const first = Promise.withResolvers<Response>()
    const fetchMock = vi.fn((url: string) => url.endsWith('first.js') ? first.promise : Promise.resolve(new Response('const second = first + 1')))
    vi.stubGlobal('fetch', fetchMock)
    const f = sandboxFixture(() => ({ matches: [], artifacts: [] }), ['https://example.test/first.js', 'https://example.test/second.js'])
    try {
      f.mount()
      f.mount()
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
      expect(mountLoomSandboxRenderer).not.toHaveBeenCalled()
      first.resolve(new Response('const first = 1'))
      await vi.waitFor(() => expect(mountLoomSandboxRenderer).toHaveBeenCalledTimes(2))
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(f.definition.script.requires)
      expect(vi.mocked(mountLoomSandboxRenderer).mock.calls[0]![2].source).toBe('const first = 1\n;\nconst second = first + 1\n;\nexport const renderers = {}')
      f.runtime.reconcile([{ ...f.definition, source: 'saved source', script: { ...f.definition.script, version: 2, requires: ['https://example.test/new.js'] } }])
      f.mount()
      await vi.waitFor(() => expect(mountLoomSandboxRenderer).toHaveBeenCalledTimes(3))
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(vi.mocked(mountLoomSandboxRenderer).mock.calls[2]![2].source).toContain('const first = 1')
    } finally { f.runtime.dispose() }
  })

  it.each(['unload', 'refresh'] as const)('cancels pending prerequisites on %s and ignores late results', async action => {
    const response = Promise.withResolvers<Response>()
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => response.promise)
    vi.stubGlobal('fetch', fetchMock)
    const f = sandboxFixture(() => ({ matches: [], artifacts: [] }), ['https://example.test/slow.js'])
    try {
      f.mount()
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
      const signal = fetchMock.mock.calls[0]![1]!.signal!
      if (action === 'unload') f.runtime.reconcile([])
      else f.runtime.reconcile([{ ...f.definition, mountVersion: 2, source: 'refreshed', script: { ...f.definition.script, requires: [] } }])
      expect(signal.aborted).toBe(true)
      response.resolve(new Response('late prerequisite'))
      await response.promise
      if (action === 'refresh') {
        const registration = f.rendererHost.list('narrative.timeline.tail')[0]!
        registration.sandboxMount!({} as HTMLElement, { scope: { kind: 'timeline', key: 'timeline' } } as ClientRendererContext)
        await vi.waitFor(() => expect(mountLoomSandboxRenderer).toHaveBeenCalledOnce())
        expect(vi.mocked(mountLoomSandboxRenderer).mock.calls[0]![2].source).toBe('refreshed')
      } else {
        await Promise.resolve()
        await Promise.resolve()
        expect(mountLoomSandboxRenderer).not.toHaveBeenCalled()
      }
      expect(f.rendererHost.diagnostics()).toEqual([])
    } finally { f.runtime.dispose() }
  })

  it('reports a failed prerequisite without creating a sandbox or downloading later prerequisites', async () => {
    const fetchMock = vi.fn(async () => new Response('missing', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    const f = sandboxFixture(() => ({ matches: [], artifacts: [] }), ['https://example.test/missing.js', 'https://example.test/later.js'])
    try {
      f.mount()
      await vi.waitFor(() => expect(f.rendererHost.diagnostics()).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'renderer.sandbox_failed', message: 'Loom Script dependency failed: https://example.test/missing.js (404)' }),
      ])))
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(mountLoomSandboxRenderer).not.toHaveBeenCalled()
    } finally { f.runtime.dispose() }
  })

  it('revokes a renderer Timeline State call as soon as the host returns to preview', async () => {
    const f = sandboxFixture(() => ({ matches: [], artifacts: [] }))
    f.rendererHost.setScopeSnapshot({ workspace: 'workspace', timelineId: 'timeline', branchId: 'main' })
    const handle = f.mount()
    await vi.waitFor(() => expect(mountLoomSandboxRenderer).toHaveBeenCalledOnce())
    const options = vi.mocked(mountLoomSandboxRenderer).mock.calls[0]![2]
    await expect(options.stateRead({ scope: 'timeline', timelineId: 'timeline', branchId: 'main' })).resolves.toBeUndefined()
    f.rendererHost.setScopeSnapshot({ workspace: 'workspace', cardId: 'card' })
    await expect(options.stateRead({ scope: 'timeline', timelineId: 'timeline', branchId: 'main' })).rejects.toThrow('outside the mounted Renderer scope')
    handle.dispose()
    f.runtime.dispose()
  })

  it('keeps instances separate, ignores superseded input results and revokes mounted instances on disposal', async () => {
    const slow = Promise.withResolvers<{ matches: []; artifacts: [] }>()
    const resolveInputs = vi.fn().mockReturnValueOnce(slow.promise).mockResolvedValue({ matches: [], artifacts: [] })
    const f = sandboxFixture(resolveInputs)
    const first = f.mount()
    await vi.waitFor(() => expect(resolveInputs).toHaveBeenCalledOnce())
    const newer = { scope: { kind: 'timeline', key: 'newer' } } as ClientRendererContext
    first.update!(newer)
    const second = f.mount()
    await vi.waitFor(() => expect(mountLoomSandboxRenderer).toHaveBeenCalledTimes(2))
    slow.resolve({ matches: [], artifacts: [] })
    await Promise.resolve()
    await Promise.resolve()
    expect(mountLoomSandboxRenderer).toHaveBeenCalledTimes(2)
    const handles = vi.mocked(mountLoomSandboxRenderer).mock.results.map(result => result.value)
    first.update!(newer)
    await vi.waitFor(() => expect(handles[0].update).toHaveBeenCalledOnce())
    expect(handles[1].update).not.toHaveBeenCalled()
    f.runtime.dispose()
    expect(handles[0].dispose).toHaveBeenCalledOnce()
    expect(handles[1].dispose).toHaveBeenCalledOnce()
    first.dispose(); second.dispose()
    expect(handles[0].dispose).toHaveBeenCalledOnce()
  })
  it('returns a cleanup handle and reports synchronous input failures', async () => {
    const f = sandboxFixture(() => { throw new Error('Input failed') })
    let handle: ReturnType<typeof f.mount> | undefined
    expect(() => { handle = f.mount() }).not.toThrow()
    expect(handle?.dispose).toBeTypeOf('function')
    await vi.waitFor(() => expect(f.rendererHost.diagnostics()).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'renderer.projection_failed', message: 'Input failed' }),
    ])))
    await handle!.dispose()
    f.runtime.dispose()
  })

  it('does not resolve inputs for a sandbox already disposed before initialization', async () => {
    const resolveInputs = vi.fn(() => { throw new Error('Must not run') })
    const f = sandboxFixture(resolveInputs)
    await f.mount().dispose()
    await Promise.resolve()
    expect(resolveInputs).not.toHaveBeenCalled()
    expect(f.rendererHost.diagnostics()).toEqual([])
    f.runtime.dispose()
  })

  it('ignores a late input rejection after the sandbox is disposed', async () => {
    const pending = Promise.withResolvers<never>()
    const resolveInputs = vi.fn(() => pending.promise)
    const f = sandboxFixture(resolveInputs)
    const handle = f.mount()
    await vi.waitFor(() => expect(resolveInputs).toHaveBeenCalledOnce())
    await handle.dispose()
    pending.reject(new Error('Late failure'))
    await pending.promise.catch(() => undefined)
    await Promise.resolve()
    await Promise.resolve()
    expect(f.rendererHost.diagnostics()).toEqual([])
    f.runtime.dispose()
  })

  it('keeps saved versions until refresh and isolates adoption mounts without key collisions', () => {
    const rendererHost = createClientRendererHost()
    rendererHost.register({
      owner: { kind: 'extension', packageId: 'script-doc', moduleId: '1' },
      definition: contribution.renderer,
      mount: vi.fn(),
    })
    const runtime = createLoomScriptRendererRuntime({ rendererHost, resolveInputs: () => ({ matches: [], artifacts: [] }), stateRead: vi.fn() })
    const mount = {
      mountId: 'mount-1', mountVersion: 1, enabled: true, orderIndex: 0, grantedCapabilities: [], source: 'export const renderers = {}',
      script: { id: 'script-doc', version: 1, requestedCapabilities: [], contributions: [contribution] },
    }
    runtime.reconcile([mount])
    expect(rendererHost.list('narrative.timeline.tail').map(item => item.owner)).toEqual([
      { kind: 'extension', packageId: 'script-doc', moduleId: '1' },
      { kind: 'script', scriptDocumentId: 'script-doc', documentVersion: 1, mountId: 'mount-1' },
    ])
    runtime.reconcile([{ ...mount, script: { ...mount.script, version: 2 } }])
    expect(rendererHost.list('narrative.timeline.tail').map(item => item.owner)).toContainEqual({ kind: 'script', scriptDocumentId: 'script-doc', documentVersion: 1, mountId: 'mount-1' })
    runtime.reconcile([{ ...mount, mountVersion: 2, script: { ...mount.script, version: 2 } }, { ...mount, mountId: 'mount-2' }])
    expect(rendererHost.list('narrative.timeline.tail')).toHaveLength(3)
    expect(rendererHost.list('narrative.timeline.tail').map(item => item.owner)).toContainEqual({ kind: 'script', scriptDocumentId: 'script-doc', documentVersion: 2, mountId: 'mount-1' })
    expect(rendererHost.list('narrative.timeline.tail').map(item => item.owner)).not.toContainEqual({ kind: 'script', scriptDocumentId: 'script-doc', documentVersion: 1, mountId: 'mount-1' })
    runtime.reconcile([{ ...mount, enabled: false }])
    expect(rendererHost.list('narrative.timeline.tail')).toHaveLength(1)
  })

  it('accepts only display-addressable matches and retains artifact source identity', () => {
    expect(projectLoomScriptInputs(contribution, {
      matches: [
        { matchId: 'hidden', ruleId: 'status-rule', value: 'ignored' },
        { matchId: 'shown', ruleId: 'status-rule', value: 'ready', displayRange: { start: 2, end: 7 } },
      ],
      artifacts: [{ id: 'artifact-1', artifactType: 'status', sourceEntryId: 'entry-9', value: { label: 'Ready' } }],
    })).toEqual([
      { kind: 'match', id: 'shown', value: { value: 'ready', displayRange: { start: 2, end: 7 } } },
      { kind: 'artifact', id: 'artifact-1', artifactType: 'status', value: { value: { label: 'Ready' }, sourceEntryId: 'entry-9' } },
    ])
  })

  it('projects inline contributions through stable match-ref anchors', async () => {
    const rendererHost = createClientRendererHost()
    const inlineContribution: LoomScriptRendererContribution = {
      kind: 'renderer',
      renderer: { id: 'inline-status', name: 'Inline Status', surface: 'narrative.entry.inline', instanceScope: 'node' },
      inputs: [{ kind: 'match', ruleId: 'status-rule' }],
    }
    const runtime = createLoomScriptRendererRuntime({
      rendererHost,
      resolveInputs: () => ({
        matches: [{ matchId: 'match-1', ruleId: 'status-rule', value: 'ready', displayRange: { start: 4, end: 9 } }],
        artifacts: [],
      }),
      stateRead: vi.fn(),
    })
    runtime.reconcile([{
      mountId: 'mount-inline', enabled: true, orderIndex: 0, grantedCapabilities: [], source: 'export const renderers = {}',
      script: { id: 'script-inline', version: 1, requestedCapabilities: [], contributions: [inlineContribution] },
    }])

    const registration = rendererHost.list('narrative.entry.inline')[0]!
    const projected = await registration.projectNodeWithAnchors!({
      nodeId: 'node-1', timelineId: 'timeline-1', rawText: 'xxx ready', displayText: 'xxx ready', surface: 'narrative', signal: new AbortController().signal,
    })
    expect(projected.matches.get('match-1')).toEqual({ start: 4, end: 9 })
    expect(projected.mounts).toEqual([expect.objectContaining({
      target: { slot: 'node.inline', selector: { kind: 'match-ref', matchId: 'match-1' }, placement: 'replace' },
    })])
  })
})
