import type {
  ClientRenderer,
  ClientRendererScope,
  RendererContributionDefinition,
  RendererSurface,
} from '@loom-studio/extension-sdk'
import {
  claimExclusiveRenderer,
  orderRendererContributions,
  rendererContributionKey,
  rendererSurfacePolicies,
  type RegisteredRendererContribution,
  type RendererRegistryDiagnostic,
} from './renderer-registry.js'

export type { ClientRendererContext, ClientRendererScope } from '@loom-studio/extension-sdk'

export type ClientRendererHandle = {
  dispose(): void | Promise<void>
}

export type ClientRendererRegistration = RegisteredRendererContribution & {
  mount: ClientRenderer['mount']
  update?: ClientRenderer['update']
  projectNode?: ClientRenderer['projectNode']
  frame?: ClientRenderer['frame']
}

export type ClientRendererScopeSnapshot = {
  workspace: string
  timelineId?: string
  agentSessionId?: string
}

export type ClientRendererInstanceSummary = {
  contributionKey: string
  surface: RendererSurface
  scope: ClientRendererScope
}

export type ClientRendererHost = {
  register(input: {
    packageId: string
    moduleId: string
    definition: RendererContributionDefinition
    mount: ClientRendererRegistration['mount']
    update?: ClientRendererRegistration['update']
    projectNode?: ClientRendererRegistration['projectNode']
    frame?: ClientRendererRegistration['frame']
  }): ClientRendererHandle
  list(surface: RendererSurface): ClientRendererRegistration[]
  find(contributionKey: string): ClientRendererRegistration | undefined
  setScopeSnapshot(snapshot: ClientRendererScopeSnapshot): void
  scopeSnapshot(): ClientRendererScopeSnapshot
  setUserOrder(surface: RendererSurface, contributionKeys: readonly string[]): void
  claim(surface: RendererSurface, scopeKey: string, contributionKey: string, options?: { replace?: boolean }): ReturnType<typeof claimExclusiveRenderer>
  release(surface: RendererSurface, scopeKey: string, contributionKey?: string): void
  activeContributionKey(surface: RendererSurface, scopeKey: string): string | undefined
  activeClaims(): Array<{ surface: RendererSurface; scopeKey: string; contributionKey: string }>
  trackInstance(surface: RendererSurface, scope: ClientRendererScope, contributionKey: string): ClientRendererHandle
  instances(): ClientRendererInstanceSummary[]
  reportDiagnostic(diagnostic: RendererRegistryDiagnostic): void
  invalidate(): void
  diagnostics(): readonly RendererRegistryDiagnostic[]
  subscribe(listener: () => void): () => void
  revision(): number
}

export function createClientRendererHost(): ClientRendererHost {
  const registrations = new Map<string, ClientRendererRegistration>()
  const userOrders = new Map<RendererSurface, readonly string[]>()
  const activeManaged = new Map<string, string>()
  const reportedDiagnostics: RendererRegistryDiagnostic[] = []
  const mountedInstances = new Map<string, ClientRendererInstanceSummary>()
  const listeners = new Set<() => void>()
  let currentRevision = 0
  let currentScopes: ClientRendererScopeSnapshot = { workspace: 'workspace' }

  function emit(): void {
    currentRevision += 1
    for (const listener of listeners) listener()
  }

  function releaseContributionClaims(contributionKey: string): void {
    for (const [claimKey, claimed] of activeManaged) {
      if (claimed === contributionKey) activeManaged.delete(claimKey)
    }
    for (const [instanceKey, instance] of mountedInstances) {
      if (instance.contributionKey === contributionKey) mountedInstances.delete(instanceKey)
    }
  }

  function releaseScopeClaims(kind: 'timeline' | 'agent-session', scopeKey: string): void {
    for (const registration of registrations.values()) {
      if (registration.definition.instanceScope !== kind) continue
      activeManaged.delete(managedClaimKey(registration.definition.surface, scopeKey))
    }
  }

  return {
    register: input => {
      const identity = {
        packageId: input.packageId,
        moduleId: input.moduleId,
        contributionId: input.definition.id,
      }
      const key = rendererContributionKey(identity)
      if (registrations.has(key)) throw new Error(`Renderer contribution is already registered: ${key}`)
      const registration: ClientRendererRegistration = {
        ...identity,
        definition: input.definition,
        mount: input.mount,
        ...(input.update ? { update: input.update } : {}),
        ...(input.projectNode ? { projectNode: input.projectNode } : {}),
        ...(input.frame ? { frame: input.frame } : {}),
      }
      registrations.set(key, registration)
      emit()
      let disposed = false
      return {
        dispose: () => {
          if (disposed) return
          disposed = true
          registrations.delete(key)
          releaseContributionClaims(key)
          emit()
        },
      }
    },
    find: contributionKey => registrations.get(contributionKey),
    setScopeSnapshot: snapshot => {
      if (JSON.stringify(currentScopes) === JSON.stringify(snapshot)) return
      if (currentScopes.timelineId && currentScopes.timelineId !== snapshot.timelineId) {
        releaseScopeClaims('timeline', currentScopes.timelineId)
      }
      if (currentScopes.agentSessionId && currentScopes.agentSessionId !== snapshot.agentSessionId) {
        releaseScopeClaims('agent-session', currentScopes.agentSessionId)
      }
      currentScopes = { ...snapshot }
      emit()
    },
    scopeSnapshot: () => ({ ...currentScopes }),
    list: surface => orderRendererContributions({
      contributions: [...registrations.values()],
      surface,
      userOrder: userOrders.get(surface),
    }).contributions.map(contribution => registrations.get(rendererContributionKey(contribution))!),
    setUserOrder: (surface, contributionKeys) => {
      userOrders.set(surface, [...new Set(contributionKeys)])
      emit()
    },
    claim: (surface, scopeKey, contributionKey, options) => {
      if (!registrations.has(contributionKey)) throw new Error(`Renderer contribution is not registered: ${contributionKey}`)
      const claimKey = managedClaimKey(surface, scopeKey)
      const result = claimExclusiveRenderer({
        surface,
        currentContributionKey: activeManaged.get(claimKey),
        requestedContributionKey: contributionKey,
        replace: options?.replace,
      })
      if (result.accepted && (rendererSurfacePolicies[surface] === 'exclusive' || rendererSurfacePolicies[surface] === 'navigation')) {
        activeManaged.set(claimKey, contributionKey)
        emit()
      }
      if (!result.accepted) reportedDiagnostics.push(result.diagnostic)
      return result
    },
    release: (surface, scopeKey, contributionKey) => {
      const claimKey = managedClaimKey(surface, scopeKey)
      const active = activeManaged.get(claimKey)
      if (!active || (contributionKey && active !== contributionKey)) return
      activeManaged.delete(claimKey)
      emit()
    },
    activeContributionKey: (surface, scopeKey) => activeManaged.get(managedClaimKey(surface, scopeKey)),
    activeClaims: () => [...activeManaged.entries()].map(([key, contributionKey]) => {
      const separator = key.indexOf('@')
      return {
        surface: key.slice(0, separator) as RendererSurface,
        scopeKey: key.slice(separator + 1),
        contributionKey,
      }
    }),
    trackInstance: (surface, scope, contributionKey) => {
      const key = `${contributionKey}@${scope.key}`
      mountedInstances.set(key, { contributionKey, surface, scope: structuredClone(scope) })
      emit()
      let disposed = false
      return {
        dispose: () => {
          if (disposed) return
          disposed = true
          mountedInstances.delete(key)
          emit()
        },
      }
    },
    instances: () => [...mountedInstances.values()].map(instance => structuredClone(instance)),
    reportDiagnostic: diagnostic => {
      if (reportedDiagnostics.some(current => current.code === diagnostic.code
        && current.contributionKey === diagnostic.contributionKey
        && current.message === diagnostic.message)) return
      reportedDiagnostics.push(diagnostic)
      emit()
    },
    invalidate: emit,
    diagnostics: () => reportedDiagnostics,
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    revision: () => currentRevision,
  }
}

function managedClaimKey(surface: RendererSurface, scopeKey: string): string {
  return `${surface}@${scopeKey}`
}
