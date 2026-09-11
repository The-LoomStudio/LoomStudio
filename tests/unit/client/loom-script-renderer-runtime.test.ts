import { describe, expect, it, vi } from 'vitest'
import { createClientRendererHost } from '../../../apps/studio-client/src/features/extension-renderers/model/client-renderer-host.js'
import {
  createLoomScriptRendererRuntime,
  projectLoomScriptInputs,
  type LoomScriptRendererContribution,
} from '../../../apps/studio-client/src/features/loom-scripts/runtime/loom-script-renderer-runtime.js'

const contribution: LoomScriptRendererContribution = {
  kind: 'renderer',
  renderer: { id: 'status', name: 'Status', surface: 'narrative.timeline.tail', instanceScope: 'timeline' },
  inputs: [{ kind: 'match', ruleId: 'status-rule' }, { kind: 'artifact', artifactType: 'status' }],
}

describe('Loom Script Renderer Runtime', () => {
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
