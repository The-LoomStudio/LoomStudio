import { satisfies, validRange } from 'semver'
import { resolvePackageDependency, assertPackageDependencyRevisions } from './package-dependency.js'
import { extensionInstallationId, installedExtensionContributionId, type ExtensionDependency, type ExtensionInstallationTarget } from '@loom-studio/extension-sdk'
import { toolReferenceSchema, type AgentToolReference } from '@loom-studio/shared'
import type { DocumentTransaction } from '@loom-studio/document-store'
import type { AgentToolRegistry, ToolDefinition } from '../agents/tool-registry.js'
import { officialAgentToolDefinitions } from '../agents/official-tools/index.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments, readDocument } from '../foundation/document-store.js'
import type { AgentToolContent, CardSourceContent, ExtensionInstallationContent } from '../types.js'

export type ResolvedAgentToolReference = {
  toolId: string
  definition: ToolDefinition
  reference: AgentToolReference
  checks: Array<{ id: string; version: number }>
}

/** Resolve authors' references without granting execution or adopting another installation's tool. */
export async function resolveAgentToolReference(input: {
  reference: AgentToolReference
  packageId: string
  target: ExtensionInstallationTarget
  dependencies?: readonly ExtensionDependency[]
  localDefinitions?: ReadonlyMap<string, ToolDefinition>
  documents: DocumentTransaction
  agentTools: AgentToolRegistry
}): Promise<ResolvedAgentToolReference> {
  const reference = toolReferenceSchema.parse(input.reference)
  if (reference.kind === 'host') {
    const official = officialAgentToolDefinitions.find(tool => tool.id === reference.toolId)
    const definition = input.agentTools.list().find(tool => tool.id === reference.toolId)
    if (!official || !definition || definition.owner.namespace !== official.owner.namespace) throw new Error(`Host Tool is unavailable: ${reference.toolId}`)
    return { toolId: definition.id, definition, reference, checks: [] }
  }
  if (reference.kind === 'package' && input.localDefinitions) {
    const definition = input.localDefinitions.get(reference.contributionId)
    if (!definition) throw new Error(`Package Tool contribution is unavailable: ${reference.contributionId}`)
    return { toolId: definition.id, definition, reference, checks: [] }
  }
  const packageId = reference.kind === 'package' ? input.packageId : reference.packageId
  const target = reference.kind === 'package' ? input.target
    : reference.target === 'global' ? { kind: 'global' as const } : input.target
  if (reference.kind === 'external' && reference.target === 'card' && input.target.kind !== 'card') {
    throw new Error('Card Tool reference requires the current Card installation')
  }
  const installationId = extensionInstallationId(packageId, target)
  if (reference.kind === 'external' && packageId === input.packageId) {
    throw new Error('Use a package Tool reference for tools from the current package')
  }
  const { installation } = await resolvePackageDependency({ packageId, target, consumerPackageId: input.packageId,
    consumerTarget: input.target, dependencies: input.dependencies, documents: input.documents })
  const toolId = installedExtensionContributionId(packageId, target, reference.contributionId)
  const document = await readDocument<AgentToolContent>(input.documents, toolId, applicationDocumentTypes.agentTool)
  const origin = document.content.origin
  if (origin?.kind !== 'extension-package' || origin.packageId !== packageId || origin.contributionId !== reference.contributionId
    || (origin.installationId ?? extensionInstallationId(packageId, { kind: 'global' })) !== installationId
    || origin.packageVersion !== installation.content.packageVersion) {
    throw new Error(`Tool contribution does not belong to the selected installation: ${reference.contributionId}`)
  }
  const { origin: _origin, createdAt: _createdAt, updatedAt: _updatedAt, ...fields } = document.content
  return { toolId, definition: { ...fields, id: toolId }, reference,
    checks: [{ id: installation.id, version: installation.version }, { id: document.id, version: document.version }] }
}

export async function assertToolReferenceRevisions(documents: DocumentTransaction, resolved: readonly ResolvedAgentToolReference[]): Promise<void> {
  await assertPackageDependencyRevisions(documents, resolved.flatMap(item => item.checks))
}

/** Keep installed consumers valid when their selected dependency is updated or removed. */
export async function assertToolDependencyConsumers(input: {
  documents: DocumentTransaction
  mounts: readonly { origin: Record<string, unknown> }[]
  resources?: readonly import('@loom-studio/application-data').PromptResource[]
  packageId: string
  target: ExtensionInstallationTarget
  nextVersion?: string
  nextContributions?: ReadonlySet<string>
  nextPresetContributions?: ReadonlySet<string>
  validatePackageAsset?: import('../types.js').ApplicationRuntimeOptions['validatePackageAsset']
}): Promise<void> {
  const installations = await listDocuments<ExtensionInstallationContent>(input.documents, applicationDocumentTypes.extensionInstallation)
  const changingId = extensionInstallationId(input.packageId, input.target)
  for (const consumer of installations) {
    if (consumer.id === changingId) continue
    const dependency = consumer.content.dependencies?.find(item => item.id === input.packageId)
    const references = input.mounts.filter(mount => (mount.origin.consumerInstallationId ?? mount.origin.installationId) === consumer.id).flatMap(mount => {
      const parsed = toolReferenceSchema.safeParse(mount.origin.toolReference)
      return parsed.success && parsed.data.kind === 'external' && parsed.data.packageId === input.packageId
        && extensionInstallationId(input.packageId, parsed.data.target === 'global' ? { kind: 'global' } : consumer.content.target) === changingId ? [parsed.data] : []
    })
    const sameTarget = extensionInstallationId(input.packageId, consumer.content.target) === changingId
    const iconReferences = (input.resources ?? []).filter(resource => {
      const origin = resource.metadata.origin as { packageId?: string; installationId?: string } | undefined
      const icon = resource.metadata.icon as { packageId?: string; target?: ExtensionInstallationTarget; path?: string } | undefined
      return origin?.packageId && (origin.installationId ?? extensionInstallationId(origin.packageId, { kind: 'global' })) === consumer.id
        && icon?.packageId === input.packageId && extensionInstallationId(icon.packageId, icon.target ?? { kind: 'global' }) === changingId
    })
    if (!dependency && !references.length && !iconReferences.length) continue
    const declaredTarget = dependency?.target
    const declaredConsumer = dependency && (declaredTarget === 'global' ? input.target.kind === 'global'
      : declaredTarget === 'card' ? sameTarget && input.target.kind === 'card'
        : input.target.kind === 'global' || sameTarget)
    if (!declaredConsumer && !references.length && !iconReferences.length) continue
    if (!input.nextVersion || (dependency && (!validRange(dependency.version) || !satisfies(input.nextVersion, dependency.version)))) {
      throw new Error(`Extension ${consumer.content.packageId} requires ${input.packageId}@${dependency?.version ?? 'referenced assets'}; dependency cannot be ${input.nextVersion ? 'updated' : 'uninstalled'}`)
    }
    if (input.nextVersion && iconReferences.length) {
      if (!input.validatePackageAsset) throw new Error('Package asset validation is unavailable for dependent icons')
      for (const resource of iconReferences) {
        const icon = resource.metadata.icon as { path: string }
        await input.validatePackageAsset({ packageId: input.packageId, packageVersion: input.nextVersion, target: input.target, path: icon.path })
      }
    }
    if (input.nextContributions && references.some(reference => !input.nextContributions!.has(reference.contributionId))) {
      throw new Error(`Extension ${consumer.content.packageId} still references a removed Tool contribution from ${input.packageId}`)
    }
  }
  if (input.target.kind === 'global') {
    for (const card of await listDocuments<CardSourceContent>(input.documents, applicationDocumentTypes.cardSource)) {
      const dependency = card.content.extensionDependencies?.find(item => item.id === input.packageId)
      if (card.content.defaultPreset?.packageId === input.packageId && input.nextPresetContributions
        && !input.nextPresetContributions.has(card.content.defaultPreset.contributionId)) {
        throw new Error(`Card ${card.content.name} (${card.id}) requires Preset ${card.content.defaultPreset.contributionId}; contribution cannot be removed`)
      }
      if (dependency && (!input.nextVersion || !validRange(dependency.version) || !satisfies(input.nextVersion, dependency.version))) {
        throw new Error(`Card ${card.content.name} (${card.id}) requires ${input.packageId}@${dependency.version}; dependency cannot be ${input.nextVersion ? 'updated' : 'uninstalled'}`)
      }
    }
  }
}

export async function withToolDependencySnapshot<T>(ctx: {
  dataEngine: import('@loom-studio/data-engine').SqliteDataEngine
  promptResources: import('@loom-studio/application-data').PromptResourceStore
}, operation: (mounts: Awaited<ReturnType<typeof ctx.promptResources.listPresetToolMounts>>, assertFresh: () => void, resources: import('@loom-studio/application-data').PromptResource[]) => Promise<T>): Promise<T> {
  let stale = false
  // ponytail: mount revisions are not part of installation versions; guard the read-to-transaction interval until scoped revisions exist.
  const subscription = ctx.dataEngine.subscribeCommits(() => { stale = true })
  try {
    const mounts = await ctx.promptResources.listPresetToolMounts()
    const resources: import('@loom-studio/application-data').PromptResource[] = []
    let cursor: string | undefined
    do { const page = await ctx.promptResources.listResources({ cursor }); resources.push(...page.resources); cursor = page.nextCursor } while (cursor)
    return await operation(mounts, () => { if (stale) throw new Error('Package dependencies changed during preparation; retry') }, resources)
  } finally { subscription.dispose() }
}
