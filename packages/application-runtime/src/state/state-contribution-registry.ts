import type { StateContribution } from '@loom-studio/shared'
import { extensionInstallationId, installedExtensionContributionId, type ExtensionInstallationTarget, type ExtensionStateInitializer, type ExtensionStateInitializationContext } from '@loom-studio/extension-sdk'
import { validateStateContribution } from './state-contribution.js'
import { assertAuthorPlayerState } from '../profiles/player-state.js'

export type StateContributionSource = {
  contributionId: string
  installationId: string
  target: ExtensionInstallationTarget
  packageId: string
  moduleId: string
  instanceId: string
  packageVersion: string
  contribution: StateContribution
}

export type StateContributionRegistry = {
  register(source: Omit<StateContributionSource, 'contributionId' | 'installationId' | 'target'> & {
    target?: ExtensionInstallationTarget
    initialize?: ExtensionStateInitializer
  }): { dispose(): void }
  get(contributionId: string): StateContributionSource | undefined
  list(): StateContributionSource[]
  initialize(contributionId: string, context: ExtensionStateInitializationContext): Promise<StateContribution>
}

export function createStateContributionRegistry(): StateContributionRegistry {
  const sources = new Map<string, StateContributionSource>()
  const initializers = new Map<string, { initialize?: ExtensionStateInitializer; controller: AbortController }>()
  return {
    register: input => {
      if (!input.contribution.id.startsWith(`${input.packageId}.`)) {
        throw new Error(`Extension State contribution must use package namespace: ${input.contribution.id}`)
      }
      const target = input.target ?? { kind: 'global' }
      const contributionId = installedExtensionContributionId(input.packageId, target, input.contribution.id)
      if (sources.has(contributionId)) throw new Error(`State contribution is already registered: ${contributionId}`)
      validateStateContribution(input.contribution, { allowExternalReferences: true })
      assertAuthorPlayerState(input.contribution)
      const { initialize, ...metadata } = input
      const source: StateContributionSource = {
        ...metadata,
        contributionId,
        installationId: extensionInstallationId(input.packageId, target),
        target: structuredClone(target),
        contribution: structuredClone(input.contribution),
      }
      sources.set(source.contributionId, source)
      const controller = new AbortController()
      initializers.set(contributionId, { initialize, controller })
      return { dispose: () => {
        if (sources.get(source.contributionId) !== source) return
        controller.abort()
        initializers.delete(source.contributionId)
        sources.delete(source.contributionId)
      } }
    },
    get: contributionId => {
      const source = sources.get(contributionId)
      return source ? structuredClone(source) : undefined
    },
    list: () => [...sources.values()].map(source => structuredClone(source)),
    async initialize(contributionId, context) {
      const source = sources.get(contributionId)
      if (!source) throw new Error(`State contribution is not registered: ${contributionId}`)
      if (source.target.kind === 'card' && source.target.cardId !== context.cardId)
        throw new Error(`State contribution is outside this Card: ${contributionId}`)
      const registration = initializers.get(contributionId)!
      const contribution = structuredClone(source.contribution)
      if (!registration.initialize) return contribution
      const signal = AbortSignal.any([context.signal, registration.controller.signal])
      signal.throwIfAborted()
      const { signal: _signal, ...data } = context
      const values = await registration.initialize({ ...structuredClone(data), signal })
      signal.throwIfAborted()
      if (!values || typeof values !== 'object' || Array.isArray(values))
        throw new Error(`State initializer must return template initial values: ${contributionId}`)
      for (const [id, value] of Object.entries(values)) {
        const template = contribution.templates.find(item => item.id === id)
        if (!template) throw new Error(`State initializer cannot replace another contribution's template: ${id}`)
        template.initial = structuredClone(value)
      }
      validateStateContribution(contribution, { allowExternalReferences: true })
      assertAuthorPlayerState(contribution)
      return contribution
    },
  }
}
