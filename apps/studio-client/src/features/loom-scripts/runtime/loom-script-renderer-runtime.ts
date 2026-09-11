import type {
  ClientRendererContext,
  ClientRendererScope,
  ClientStateTarget,
  LoomSandboxRendererInput,
  RendererContributionDefinition,
} from '@loom-studio/extension-sdk'
import type { JsonValue } from '@loom-studio/shared'
import type { ClientRendererHost, ClientRendererHandle } from '../../extension-renderers/model/client-renderer-host.js'
import { rendererContributionKey } from '../../extension-renderers/model/renderer-registry.js'
import { mountLoomSandboxRenderer } from './sandbox-renderer-protocol.js'

export type LoomScriptRendererContribution = {
  kind: 'renderer'
  renderer: Omit<RendererContributionDefinition, 'adapter' | 'artifactType'>
  inputs: Array<{ kind: 'match'; ruleId: string } | { kind: 'artifact'; artifactType: string }>
}

export type ResolvedLoomScriptMount = {
  mountId: string
  enabled: boolean
  orderIndex: number
  grantedCapabilities: string[]
  script: {
    id: string
    version: number
    requestedCapabilities: string[]
    contributions: LoomScriptRendererContribution[]
  }
  source: string
}

export type LoomScriptInputProjection = {
  matches: Array<{
    matchId: string
    ruleId: string
    value: JsonValue
    displayRange?: { start: number; end: number }
  }>
  artifacts: Array<{
    id: string
    artifactType: string
    sourceEntryId: string
    value: JsonValue
  }>
}

export type LoomScriptRendererRuntime = {
  reconcile(mounts: readonly ResolvedLoomScriptMount[]): void
  dispose(): void
}

export function createLoomScriptRendererRuntime(input: {
  rendererHost: ClientRendererHost
  resolveInputs(scope: ClientRendererScope, contribution: LoomScriptRendererContribution): LoomScriptInputProjection | Promise<LoomScriptInputProjection>
  stateRead(target: { scope: 'global' } | { scope: 'timeline'; timelineId: string; branchId: string }): Promise<JsonValue>
}): LoomScriptRendererRuntime {
  const active = new Map<string, { fingerprint: string; handles: ClientRendererHandle[] }>()

  function disposeMount(mountId: string): void {
    const current = active.get(mountId)
    if (!current) return
    active.delete(mountId)
    for (const handle of current.handles.reverse()) void handle.dispose()
  }

  return {
    reconcile: mounts => {
      const nextIds = new Set(mounts.filter(mount => mount.enabled).map(mount => mount.mountId))
      for (const mountId of active.keys()) if (!nextIds.has(mountId)) disposeMount(mountId)

      for (const mount of [...mounts].sort((left, right) => left.orderIndex - right.orderIndex || left.mountId.localeCompare(right.mountId))) {
        if (!mount.enabled) continue
        const fingerprint = `${mount.script.id}@${mount.script.version}:${mount.source}:${mount.grantedCapabilities.join(',')}`
        if (active.get(mount.mountId)?.fingerprint === fingerprint) continue
        disposeMount(mount.mountId)
        const declaredContributionIds = mount.script.contributions.map(item => item.renderer.id)
        const handles: ClientRendererHandle[] = []
        for (const contribution of mount.script.contributions) {
          const owner = { kind: 'script' as const, scriptDocumentId: mount.script.id, documentVersion: mount.script.version }
          const contributionKey = rendererContributionKey({ owner, contributionId: contribution.renderer.id })
          const effectiveCapabilities = mount.grantedCapabilities.filter(capability => mount.script.requestedCapabilities.includes(capability))
          const inline = contribution.renderer.surface === 'narrative.entry.inline' || contribution.renderer.surface === 'agent.message.inline'
          handles.push(input.rendererHost.register({
            owner,
            definition: { ...contribution.renderer, adapter: 'sandbox-iframe' },
            mount: () => undefined,
            ...(inline ? {
              projectNodeWithAnchors: async context => {
                const scope = context.surface === 'narrative'
                  ? { kind: 'node' as const, key: context.nodeId, entity: { kind: 'narrative-node' as const, timelineId: context.timelineId, nodeId: context.nodeId } }
                  : { kind: 'message' as const, key: context.messageId, entity: { kind: 'agent-message' as const, agentSessionId: context.agentSessionId, messageId: context.messageId } }
                const projection = await input.resolveInputs(scope, contribution)
                const matches = projection.matches.filter(match => match.displayRange)
                return {
                  matches: new Map(matches.map(match => [match.matchId, match.displayRange!])),
                  mounts: matches.map(match => ({
                    key: `${contribution.renderer.id}:${match.matchId}`,
                    target: { slot: 'node.inline' as const, selector: { kind: 'match-ref' as const, matchId: match.matchId }, placement: 'replace' as const },
                    part: { type: 'artifact' as const, artifactType: 'loom.match-ref', content: { matchId: match.matchId } },
                  })),
                }
              },
            } : {}),
            sandboxMount: (root, context) => {
              let disposed = false
              let sandbox: ReturnType<typeof mountLoomSandboxRenderer> | undefined
              void Promise.resolve(input.resolveInputs(context.scope, contribution)).then(projection => {
                if (disposed) return
                sandbox = mountLoomSandboxRenderer(root, context, {
                  contributionId: contribution.renderer.id,
                  declaredContributionIds,
                  grantedCapabilities: effectiveCapabilities,
                  inputs: selectMountedInputs(projectLoomScriptInputs(contribution, projection), context.part),
                  scriptDocumentId: mount.script.id,
                  documentVersion: mount.script.version,
                  source: mount.source,
                  stateRead: target => {
                    if (!canReadStateTarget(context.scope, target)) {
                      return Promise.reject(new Error('Loom Script state.read target is outside the Renderer scope'))
                    }
                    return input.stateRead(target)
                  },
                  onClose: context.close,
                  onDiagnostic: diagnostic => input.rendererHost.reportDiagnostic({
                    code: diagnostic.code === 'renderer.script_export_mismatch' ? 'renderer.script_export_mismatch' : 'renderer.sandbox_failed',
                    contributionKey,
                    message: diagnostic.message,
                  }),
                })
              }).catch(error => input.rendererHost.reportDiagnostic({
                code: 'renderer.projection_failed',
                contributionKey,
                message: error instanceof Error ? error.message : String(error),
              }))
              return {
                dispose: () => {
                  disposed = true
                  sandbox?.dispose()
                },
              }
            },
          }))
        }
        active.set(mount.mountId, { fingerprint, handles })
      }
    },
    dispose: () => {
      for (const mountId of [...active.keys()]) disposeMount(mountId)
    },
  }
}

function selectMountedInputs(
  inputs: LoomSandboxRendererInput[],
  part: ClientRendererContext['part'],
): LoomSandboxRendererInput[] {
  if (part?.type !== 'artifact' || part.artifactType !== 'loom.match-ref' || !isRecord(part.content)) return inputs
  const matchId = part.content.matchId
  return typeof matchId === 'string' ? inputs.filter(item => item.kind !== 'match' || item.id === matchId) : inputs
}

function isRecord(value: JsonValue): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function canReadStateTarget(scope: ClientRendererScope, target: ClientStateTarget): boolean {
  if (target.scope === 'global') return true
  if (scope.kind === 'timeline') return scope.key === target.timelineId
  return scope.entity?.kind === 'narrative-node' && scope.entity.timelineId === target.timelineId
}

export function projectLoomScriptInputs(
  contribution: LoomScriptRendererContribution,
  projection: LoomScriptInputProjection,
): LoomSandboxRendererInput[] {
  const inputs: LoomSandboxRendererInput[] = []
  for (const requested of contribution.inputs) {
    if (requested.kind === 'match') {
      for (const match of projection.matches) {
        if (match.ruleId !== requested.ruleId || !match.displayRange) continue
        inputs.push({
          kind: 'match',
          id: match.matchId,
          value: structuredClone({ value: match.value, displayRange: match.displayRange } as unknown as JsonValue),
        })
      }
      continue
    }
    for (const artifact of projection.artifacts) {
      if (artifact.artifactType !== requested.artifactType) continue
      inputs.push({
        kind: 'artifact',
        id: artifact.id,
        artifactType: artifact.artifactType,
        value: structuredClone({ value: artifact.value, sourceEntryId: artifact.sourceEntryId } as unknown as JsonValue),
      })
    }
  }
  return inputs
}
