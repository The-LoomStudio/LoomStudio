import type { StateContribution } from '@loom-studio/shared'
import { extensionInstallationId, installedExtensionContributionId, type ExtensionInstallationTarget } from '@loom-studio/extension-sdk'
import { validateStateContribution } from './state-contribution.js'

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
  register(source: Omit<StateContributionSource, 'contributionId' | 'installationId' | 'target'> & { target?: ExtensionInstallationTarget }): { dispose(): void }
  get(contributionId: string): StateContributionSource | undefined
  list(): StateContributionSource[]
}

export function createStateContributionRegistry(): StateContributionRegistry {
  const sources = new Map<string, StateContributionSource>()
  return {
    register: input => {
      if (!input.contribution.id.startsWith(`${input.packageId}.`)) {
        throw new Error(`Extension State contribution must use package namespace: ${input.contribution.id}`)
      }
      const target = input.target ?? { kind: 'global' }
      const contributionId = installedExtensionContributionId(input.packageId, target, input.contribution.id)
      if (sources.has(contributionId)) throw new Error(`State contribution is already registered: ${contributionId}`)
      validateStateContribution(input.contribution, { allowExternalReferences: true })
      const source: StateContributionSource = {
        ...input,
        contributionId,
        installationId: extensionInstallationId(input.packageId, target),
        target: structuredClone(target),
        contribution: structuredClone(input.contribution),
      }
      sources.set(source.contributionId, source)
      return { dispose: () => { if (sources.get(source.contributionId) === source) sources.delete(source.contributionId) } }
    },
    get: contributionId => {
      const source = sources.get(contributionId)
      return source ? structuredClone(source) : undefined
    },
    list: () => [...sources.values()].map(source => structuredClone(source)),
  }
}
