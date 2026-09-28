import { beforeEach, describe, expect, it, vi } from 'vitest'
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

const contribution: LoomScriptRendererContribution = {
  kind: 'renderer',
  renderer: { id: 'status', name: 'Status', surface: 'narrative.timeline.tail', instanceScope: 'timeline' },
  inputs: [{ kind: 'match', ruleId: 'status-rule' }, { kind: 'artifact', artifactType: 'status' }],
}

function sandboxFixture(resolveInputs: Parameters<typeof createLoomScriptRendererRuntime>[0]['resolveInputs']) {
  const rendererHost = createClientRendererHost()
  const runtime = createLoomScriptRendererRuntime({ rendererHost, resolveInputs, stateRead: vi.fn() })
  runtime.reconcile([{
    mountId: 'mount', enabled: true, orderIndex: 0, grantedCapabilities: [], source: 'export const renderers = {}',
    script: { id: 'script', version: 1, requestedCapabilities: [], contributions: [contribution] },
  }])
  const registration = rendererHost.list('narrative.timeline.tail')[0]!
  const context = { scope: { kind: 'timeline', key: 'timeline' } } as ClientRendererContext
  return {
    rendererHost,
    mount: () => registration.sandboxMount!({} as HTMLElement, context),
    runtime,
  }
}

describe('Loom Script Renderer Runtime', () => {
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

  it('registers only enabled mounts and replaces pinned versions without key collisions', () => {
    const rendererHost = createClientRendererHost()
    rendererHost.register({
      owner: { kind: 'extension', packageId: 'script-doc', moduleId: '1' },
      definition: contribution.renderer,
      mount: vi.fn(),
    })
    const runtime = createLoomScriptRendererRuntime({ rendererHost, resolveInputs: () => ({ matches: [], artifacts: [] }), stateRead: vi.fn() })
    const mount = {
      mountId: 'mount-1', enabled: true, orderIndex: 0, grantedCapabilities: [], source: 'export const renderers = {}',
      script: { id: 'script-doc', version: 1, requestedCapabilities: [], contributions: [contribution] },
    }
    runtime.reconcile([mount])
    expect(rendererHost.list('narrative.timeline.tail').map(item => item.owner)).toEqual([
      { kind: 'extension', packageId: 'script-doc', moduleId: '1' },
      { kind: 'script', scriptDocumentId: 'script-doc', documentVersion: 1 },
    ])
    runtime.reconcile([{ ...mount, script: { ...mount.script, version: 2 } }])
    expect(rendererHost.list('narrative.timeline.tail').map(item => item.owner)).toContainEqual({ kind: 'script', scriptDocumentId: 'script-doc', documentVersion: 2 })
    expect(rendererHost.list('narrative.timeline.tail').map(item => item.owner)).not.toContainEqual({ kind: 'script', scriptDocumentId: 'script-doc', documentVersion: 1 })
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
