import { resolvePackageIcon, assertPackageDependencyRevisions } from '../extensions/package-dependency.js'
import { createHash } from 'node:crypto'
import { authoringApplySchema, authoringResourceSchema, toolReferenceSchema, type AuthoringApplyInput, type AuthoringResource, type AuthoringNode, type JsonObject } from '@loom-studio/shared'
import type { PromptResource } from '@loom-studio/application-data'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { readDocument } from '../foundation/document-store.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import type { ExtensionInstallationContent, RuntimeRequestContext } from '../types.js'
import { normalizeMacros } from '../cards/card.js'
import { normalizePromptResourceArtifact } from '../cards/card-bundle-codec.js'
import { toStoredNode } from '../prompt/prompt-resource-mapper.js'
import { extensionInstallationId } from '@loom-studio/extension-sdk'
import { narrativeWriteContext, requireDocumentParticipant } from './context.js'
import { officialAgentToolDefinitions } from '../agents/official-tools/index.js'
import { isPromptActivation } from '../prompt/prompt-activation.js'
import { resolveAgentToolReference, assertToolReferenceRevisions, type ResolvedAgentToolReference } from '../extensions/tool-reference.js'

type Context = Pick<ApplicationRuntimeContext, 'dataEngine' | 'promptResources' | 'agentTools' | 'documents' | 'validatePackageAsset'>
const fields = ['macros', 'macroOptions', 'useCardLore', 'useGlobalLore', 'useCardText', 'useGlobalText'] as const
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(value)
}
function digest(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex') }
function conflict(message: string): never { throw Object.assign(new Error(message), { code: 'prompt_resource.conflict' }) }
function origin(resource: PromptResource) { return resource.metadata.origin as { kind?: string; packageId?: string; installationId?: string; contributionId?: string } | undefined }
function canonicalAuthorNode(input: AuthoringNode): AuthoringNode {
  const node = structuredClone(input)
  if (node.kind === 'message') node.capabilities = { ...node.capabilities, roleHint: node.capabilities?.roleHint ?? 'system' }
  if (node.capabilities && !Object.keys(node.capabilities).length) delete node.capabilities
  if (node.kind === 'entry') node.body ??= ''
  if (['module', 'folder', 'message'].includes(node.kind)) node.children = (node.children ?? []).map(canonicalAuthorNode)
  return node
}
function project(resource: PromptResource, loreMounts: AuthoringResource['loreMounts'], toolMounts: AuthoringResource['toolMounts']): AuthoringResource {
  const icon = resource.metadata.icon as JsonObject | undefined
  const portableIcon = icon ? Object.fromEntries(Object.entries(icon).filter(([key]) => key !== 'target')) : undefined
  return authoringResourceSchema.parse({ format: 'loom.resource.authoring', schemaVersion: 1, id: resource.id,
    resourceKind: resource.resourceKind, rootNode: canonicalAuthorNode(resource.rootNode as AuthoringNode),
    ...Object.fromEntries(fields.filter(key => resource.metadata[key] !== undefined).map(key => [key, resource.metadata[key]])),
    ...(portableIcon ? { metadata: { icon: portableIcon } } : {}),
    ...(resource.resourceKind === 'preset' ? { loreMounts: loreMounts ?? [], toolMounts: toolMounts ?? [] } : {}),
  })
}
export function createResourceAuthoringRuntimeMethods(ctx: Context) {
  async function capture(resourceId: string) {
    const stored = await ctx.promptResources.getResource(resourceId)
    if (!stored) throw new Error(`Prompt resource not found: ${resourceId}`)
    const lore = stored.resourceKind === 'preset' ? await ctx.promptResources.listLoreMounts({ source: { kind: 'preset', id: resourceId } }) : []
    const tools = stored.resourceKind === 'preset' ? await ctx.promptResources.listPresetToolMounts({ presetResourceId: resourceId }) : []
    const resource = project(stored,
      lore.map(mount => mount.reference ?? { kind: 'external', resourceId: mount.loreResourceId }),
      tools.map(({ toolId, orderIndex, defaultEnabled, activation, provider, content, origin }) => ({
        ...(origin.toolReference !== undefined ? { reference: toolReferenceSchema.parse(origin.toolReference) }
          : officialAgentToolDefinitions.some(tool => tool.id === toolId) ? { reference: { kind: 'host' as const, toolId } } : { toolId }),
        orderIndex, defaultEnabled, ...(activation ? { activation } : {}), ...(provider ? { provider } : {}), ...(content ? { content } : {}),
      })))
    return { stored, lore, tools, snapshot: { resource, version: stored.version, digest: digest(resource) } }
  }
  async function allResources() {
    const resources: PromptResource[] = []
    let cursor: string | undefined
    do { const page = await ctx.promptResources.listResources({ cursor }); resources.push(...page.resources); cursor = page.nextCursor } while (cursor)
    return resources
  }
  async function prepare(input: AuthoringApplyInput) {
    const parsed = authoringApplySchema.parse(input)
    const ids = new Set<string>()
    for (const item of parsed.resources) {
      if (ids.has(item.resource.id)) throw new Error(`Duplicate resource ID: ${item.resource.id}`)
      ids.add(item.resource.id)
    }
    const available = await allResources()
    const nodes = new Map<string, string>()
    const indexNodes = (node: AuthoringResource['rootNode'] | PromptResource['rootNode'], resourceId: string) => {
      const owner = nodes.get(node.id)
      if (owner && owner !== resourceId) throw new Error(`Node belongs to another resource: ${node.id}`)
      nodes.set(node.id, resourceId)
      node.children?.forEach(child => indexNodes(child, resourceId))
    }
    for (const resource of available) indexNodes(resource.rootNode, resource.id)
    for (const item of parsed.resources) indexNodes(item.resource.rootNode, item.resource.id)
    return Promise.all(parsed.resources.map(async item => {
      const existing = await ctx.promptResources.getResource(item.resource.id, { includeTombstone: true })
      if (item.create) {
        if (existing) conflict(`Resource already exists: ${item.resource.id}`)
        if (item.expectedVersion !== undefined || item.expectedDigest !== undefined) throw new Error('Create must not contain an update baseline')
      } else if (!existing || existing.tombstoned) conflict(`Resource missing or deleted: ${item.resource.id}`)
      const before = existing ? await capture(existing.id) : undefined
      if (before && (item.expectedVersion !== before.snapshot.version || item.expectedDigest !== before.snapshot.digest)) conflict(`Resource changed since export: ${item.resource.id}`)
      if (existing && existing.resourceKind !== item.resource.resourceKind) throw new Error('Cannot change resource kind')
      if (existing && existing.rootNodeId !== item.resource.rootNode.id) throw new Error('Cannot replace stable root node identity')
      if (item.resource.resourceKind === 'lore' && (item.resource.loreMounts?.length || item.resource.toolMounts?.length)) throw new Error('Only presets can own mounts')
      const resource: AuthoringResource = { ...item.resource, ...(item.resource.resourceKind === 'preset' ? { loreMounts: item.resource.loreMounts ?? [], toolMounts: item.resource.toolMounts ?? [] } : {}) }
      if (resource.macros !== undefined) resource.macros = normalizeMacros(resource.macros, 'Preset')
      const artifact = normalizePromptResourceArtifact({ ...resource, format: 'loom.promptResource', schemaVersion: 2 })
      toStoredNode(artifact.rootNode) // Reuse domain validation without rewriting legacy extra metadata.
      resource.rootNode = canonicalAuthorNode(resource.rootNode)
      if (!resource.metadata?.icon) delete resource.metadata
      if (resource.resourceKind === 'lore') { delete resource.loreMounts; delete resource.toolMounts }
      const owner = existing ? origin(existing) : undefined
      const loreMounts = await Promise.all((resource.loreMounts ?? []).map(async (reference, orderIndex) => {
        let target: PromptResource | undefined
        if (reference.kind === 'package') {
          if (owner?.kind !== 'extension-package') throw new Error('Package Lore reference requires an installed extension owner')
          const matches = available.filter(candidate => {
            const source = origin(candidate)
            return source?.kind === 'extension-package' && source.packageId === owner.packageId && (source.installationId ?? extensionInstallationId(source.packageId!, { kind: 'global' })) === (owner.installationId ?? extensionInstallationId(owner.packageId!, { kind: 'global' })) && source.contributionId === reference.contributionId
          })
          if (matches.length !== 1) throw new Error(`Ambiguous or missing package Lore: ${reference.contributionId}`)
          target = matches[0]
        } else {
          target = available.find(candidate => candidate.id === reference.resourceId)
          if (reference.origin) {
            const source = target && origin(target)
            if (source?.packageId !== reference.origin.packageId || source?.contributionId !== reference.origin.contributionId) throw new Error('External Lore origin does not match')
            const installation = await readDocument<ExtensionInstallationContent>(ctx.documents, source.installationId ?? extensionInstallationId(source.packageId!, { kind: 'global' }), applicationDocumentTypes.extensionInstallation)
            if (installation.content.target.kind !== reference.origin.target) throw new Error('External Lore installation target does not match')
          }
        }
        const pending = reference.kind === 'external' ? parsed.resources.find(candidate => candidate.create && candidate.resource.id === reference.resourceId)?.resource : undefined
        if ((target?.resourceKind ?? pending?.resourceKind) !== 'lore') throw new Error(`Lore reference is unavailable: ${JSON.stringify(reference)}`)
        const previous = before?.lore.find(mount => canonical(mount.reference ?? { kind: 'external', resourceId: mount.loreResourceId }) === canonical(reference))
        return { loreResourceId: target?.id ?? pending!.id, reference, orderIndex, origin: previous?.origin ?? { kind: 'manual' } }
      }))
      resource.toolMounts = resource.toolMounts?.map(mount => {
        if (mount.reference || !officialAgentToolDefinitions.some(tool => tool.id === mount.toolId)) return mount
        const { toolId, ...settings } = mount
        return { ...settings, reference: { kind: 'host' as const, toolId: toolId! } }
      })
      const resolvedTools: ResolvedAgentToolReference[] = []
      const iconChecks: Array<{ id: string; version: number }> = []
      const requiresOwner = resource.toolMounts?.some(mount => mount.reference && mount.reference.kind !== 'host')
      if (requiresOwner && (owner?.kind !== 'extension-package' || !owner.packageId)) throw new Error('Package Tool references require an installed extension owner')
      const installation = requiresOwner ? await readDocument<ExtensionInstallationContent>(ctx.documents,
        owner!.installationId ?? extensionInstallationId(owner!.packageId!, { kind: 'global' }), applicationDocumentTypes.extensionInstallation) : undefined
      const toolMounts = await Promise.all((resource.toolMounts ?? []).map(async mount => {
        const { reference, toolId: legacyToolId, ...settings } = mount
        const resolved = reference ? await resolveAgentToolReference({ reference, packageId: owner?.packageId ?? '',
          target: installation?.content.target ?? { kind: 'global' }, dependencies: installation?.content.dependencies,
          documents: ctx.documents, agentTools: ctx.agentTools }) : undefined
        if (resolved) {
          if (installation) resolved.checks.push({ id: installation.id, version: installation.version })
          resolvedTools.push(resolved)
        }
        const toolId = resolved?.toolId ?? legacyToolId!
        const definition = resolved?.definition ?? ctx.agentTools.list().find(tool => tool.id === toolId)
        if (!definition) throw new Error(`Tool unavailable: ${toolId}`)
        if (mount.activation !== undefined && !isPromptActivation(mount.activation)) throw new Error(`Preset Tool activation is invalid: ${toolId}`)
        if (definition.input.kind === 'structured' && mount.content !== undefined) throw new Error(`Structured Tool cannot use Content placement: ${toolId}`)
        const previousOrigin = before?.tools.find(previous => previous.toolId === toolId)?.origin ?? { kind: 'manual' }
        const { toolReference: _oldReference, ...mountOrigin } = previousOrigin
        return { ...settings, toolId, origin: { ...mountOrigin,
          ...(owner?.kind === 'extension-package' && owner.packageId ? {
            consumerInstallationId: owner.installationId ?? extensionInstallationId(owner.packageId, { kind: 'global' }),
          } : {}),
          ...(reference ? { toolReference: reference } : {}),
        } }
      }))
      if (new Set(toolMounts.map(mount => mount.toolId)).size !== toolMounts.length) throw new Error('Duplicate resolved Tool mounts')
      const metadata: JsonObject = { ...(existing?.metadata ?? {}) }
      for (const key of fields) { delete metadata[key]; if (resource[key] !== undefined) metadata[key] = resource[key]! }
      delete metadata.icon
      if (resource.metadata?.icon) {
        const unchanged = canonical(resource.metadata.icon) === canonical(before?.snapshot.resource.metadata?.icon)
        if (unchanged) metadata.icon = structuredClone(existing!.metadata.icon!)
        else {
          let resolved: Awaited<ReturnType<typeof resolvePackageIcon>>
          if (owner?.kind === 'extension-package' && owner.packageId) {
            const consumer = installation ?? await readDocument<ExtensionInstallationContent>(ctx.documents,
              owner.installationId ?? extensionInstallationId(owner.packageId, { kind: 'global' }), applicationDocumentTypes.extensionInstallation)
            resolved = await resolvePackageIcon({ icon: resource.metadata.icon, consumerPackageId: owner.packageId,
              consumerTarget: consumer.content.target, dependencies: consumer.content.dependencies, documents: ctx.documents })
            iconChecks.push({ id: consumer.id, version: consumer.version })
          } else {
            const icon = resource.metadata.icon
            const previous = existing?.metadata.icon as { packageId?: string; target?: ExtensionInstallationContent['target'] } | undefined
            const retainedCard = previous?.packageId === icon.packageId && previous.target?.kind === 'card' ? previous.target : undefined
            if (icon.scope === 'card' && !retainedCard) throw new Error('Personal preset has no Card installation context for this icon')
            const target = icon.scope === 'global' ? { kind: 'global' as const } : retainedCard ?? { kind: 'global' as const }
            const assetInstallation = await readDocument<ExtensionInstallationContent>(ctx.documents,
              extensionInstallationId(icon.packageId, target), applicationDocumentTypes.extensionInstallation)
            if (assetInstallation.content.packageId !== icon.packageId
              || extensionInstallationId(icon.packageId, assetInstallation.content.target) !== assetInstallation.id) throw new Error('Icon installation identity mismatch')
            resolved = { icon: { ...icon, target }, packageVersion: assetInstallation.content.packageVersion,
              checks: [{ id: assetInstallation.id, version: assetInstallation.version }], sameInstallation: false }
          }
          if (!ctx.validatePackageAsset) throw new Error('Package asset validation is unavailable')
          await ctx.validatePackageAsset({ packageId: resolved.icon.packageId, packageVersion: resolved.packageVersion, target: resolved.icon.target, path: resolved.icon.path })
          metadata.icon = resolved.icon
          iconChecks.push(...resolved.checks)
        }
      }
      if (!existing && resource.resourceKind === 'preset') { metadata.historyPolicy = 'persistent'; metadata.delivery = 'stream' }
      return { resource, before, metadata, loreMounts, toolMounts, resolvedTools, iconChecks, changed: !before || digest(resource) !== before.snapshot.digest }
    }))
  }
  async function stable<T>(operation: (isStale: () => boolean) => Promise<T>) {
    let stale = false
    // ponytail: preparation spans multiple store reads; reject any concurrent commit until scoped read revisions exist.
    const subscription = ctx.dataEngine.subscribeCommits(() => { stale = true })
    try { return await operation(() => stale) } finally { subscription.dispose() }
  }
  return {
    captureResourceAuthoring: (input: { resourceId: string }) => stable(async isStale => {
      const result = await capture(input.resourceId)
      if (isStale()) conflict('Resource changed during capture; retry')
      return result.snapshot
    }),
    diffResourceAuthoring: (input: AuthoringApplyInput) => stable(async isStale => {
      const prepared = await prepare(input)
      if (isStale()) conflict('Resource changed during diff; retry')
      return { changes: prepared.map(item => ({ resourceId: item.resource.id, kind: !item.before ? 'create' as const : item.changed ? 'update' as const : 'unchanged' as const,
        ...(item.before ? { before: item.before.snapshot.resource } : {}), after: item.resource })) }
    }),
    applyResourceAuthoring: (input: AuthoringApplyInput, context?: RuntimeRequestContext) => stable(async isStale => {
      const prepared = await prepare(input)
      if (isStale()) conflict('Resource changed during preparation; retry')
      if (prepared.every(item => !item.changed)) return { resources: prepared.map(item => item.before!.snapshot) }
      const result = await ctx.dataEngine.transact(narrativeWriteContext(context, 'application.applyResourceAuthoring'), async tx => {
        if (isStale()) conflict('Resource changed before Apply; retry')
        return (await requireDocumentParticipant(ctx).participateTransaction(tx, async documents => {
        await assertToolReferenceRevisions(documents, prepared.flatMap(item => item.resolvedTools))
        await assertPackageDependencyRevisions(documents, prepared.flatMap(item => item.iconChecks))
        const store = ctx.promptResources.transaction(tx)
        const written = new Map<string, PromptResource>()
        for (const item of prepared) {
          if (!item.changed) { written.set(item.resource.id, item.before!.stored); continue }
          const rootNode = item.resource.rootNode
          const next = item.before ? store.mutateResource({ resourceId: item.resource.id, expectedVersion: item.before.stored.version,
            mutations: [{ kind: 'tree.replace', rootNode }, { kind: 'resource.update', patch: { label: rootNode.label, metadata: item.metadata } }] })
            : store.createResource({ id: item.resource.id, resourceKind: item.resource.resourceKind, rootNode, label: rootNode.label, metadata: item.metadata })
          written.set(item.resource.id, next)
        }
        for (const item of prepared) {
          if (!item.changed || item.resource.resourceKind !== 'preset') continue
          if (!item.before || canonical(item.resource.loreMounts) !== canonical(item.before.snapshot.resource.loreMounts)) store.replaceLoreMounts({ expectedMountIds: store.listLoreMounts({ source: { kind: 'preset', id: item.resource.id } }).map(mount => mount.id), source: { kind: 'preset', id: item.resource.id }, mounts: item.loreMounts })
          if (!item.before || canonical(item.resource.toolMounts) !== canonical(item.before.snapshot.resource.toolMounts)) store.replacePresetToolMounts({ expectedMountIds: store.listPresetToolMounts({ presetResourceId: item.resource.id }).map(mount => mount.id), presetResourceId: item.resource.id,
            mounts: item.toolMounts })
        }
        return prepared.map(item => { const resource = project(written.get(item.resource.id)!, item.resource.loreMounts, item.resource.toolMounts); return { resource, version: written.get(item.resource.id)!.version, digest: digest(resource) } })
        }, { allowEmpty: true })).value
      })
      return { resources: result.value }
    }),
  }
}
