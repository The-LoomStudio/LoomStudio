import { createHash } from 'node:crypto'
import type { PromptResource } from '@loom-studio/application-data'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { normalizePromptResourceArtifact } from '../cards/card-bundle-codec.js'
import { fromStoredResource, toStoredResourceInput } from '../prompt/prompt-resource-mapper.js'
import type { PromptResourceArtifact, PromptResourceNode } from '../prompt/prompt-resource-types.js'
import type { ApplyPromptPackageUpdateInput, ApplyPromptPackageUpdateResult, PreviewPromptPackageUpdateInput, PreviewPromptPackageUpdateResult, RuntimeRequestContext } from '../types.js'
import { promptResourceWriteContext } from './context.js'

function walk(node: PromptResourceNode): PromptResourceNode[] { return [node, ...(node.children ?? []).flatMap(walk)] }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]))
  return value
}
function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex') }
export function promptPackageAttachmentsDigest(artifact: PromptResourceArtifact): string {
  return digest({ scripts: artifact.scriptAttachments ?? [], rules: artifact.textTransformRules ?? [], lore: artifact.loreMounts ?? [], text: artifact.textUses ?? [] })
}
export function promptPackageNodeIds(original: PromptResourceNode, cloned: PromptResourceNode): Record<string, string> {
  const from = walk(original)
  const to = walk(cloned)
  return Object.fromEntries(from.map((node, index) => [node.id, to[index]!.id]))
}
function remap(root: PromptResourceNode, ids: Record<string, string>, anchors: Set<string>): PromptResourceNode {
  const id = (value: string) => Object.hasOwn(ids, value) ? ids[value]! : value
  return { ...structuredClone(root), id: id(root.id),
    ...(root.capabilities?.targetAnchorId && anchors.has(root.capabilities.targetAnchorId) ? { capabilities: { ...root.capabilities, targetAnchorId: id(root.capabilities.targetAnchorId) } } : {}),
    ...(root.children ? { children: root.children.map(child => remap(child, ids, anchors)) } : {}),
  }
}
function display(resource: ReturnType<typeof fromStoredResource>): PromptResourceArtifact {
  return { format: 'loom.promptResource', schemaVersion: 2, resourceKind: resource.resourceKind,
    ...(resource.metadata ? { metadata: resource.metadata } : {}), rootNode: resource.rootNode,
    macros: resource.macros ?? {}, macroOptions: resource.macroOptions ?? {} }
}
type Context = Pick<ApplicationRuntimeContext, 'dataEngine' | 'promptResources' | 'now' | 'createId'>
export function createPromptPackageUpdateMethods(ctx: Context) {
  function preview(stored: PromptResource, artifactInput: PromptResourceArtifact) {
    const artifact = normalizePromptResourceArtifact(artifactInput)
    const local = fromStoredResource(stored)
    const release = artifact.metadata?.release
    if (!release || !local.sourcePackage || local.sourcePackage.releaseId !== release.id || local.metadata?.release?.id !== release.id) {
      throw new Error('Prompt package source identity cannot be proven; import it as a new resource')
    }
    if (local.origin || local.sourceArtifactRef) throw new Error('Use the owning package update for this resource')
    if (artifact.rootNode.id !== local.sourcePackage.rootId || artifact.resourceKind !== local.resourceKind) throw new Error('Prompt package root identity or kind changed')
    const nodes = walk(artifact.rootNode)
    if (new Set(nodes.map(node => node.id)).size !== nodes.length) throw new Error('Duplicate Prompt package node identity')
    const anchors = new Set(nodes.filter(node => node.kind === 'virtual' && !node.capabilities?.targetAnchorId).map(node => node.id))
    const incoming = { ...artifact, rootNode: remap(artifact.rootNode, local.sourcePackage.nodeIds, anchors) }
    const result: PreviewPromptPackageUpdateResult = {
      resourceId: stored.id, expectedVersion: stored.version, fingerprint: digest({ stored, artifact }), local: display(local), incoming,
      // ponytail: attachment changes require a separate permission/adoption flow before in-place support.
      blockingChanges: promptPackageAttachmentsDigest(artifact) === local.sourcePackage.attachmentsDigest ? []
        : ['Script attachments, text rules or resource bindings changed; use their dedicated adoption flow'],
    }
    return { result, local, artifact, anchors }
  }
  return {
    previewPromptPackageUpdate: async (input: PreviewPromptPackageUpdateInput): Promise<PreviewPromptPackageUpdateResult> => {
      const stored = await ctx.promptResources.getResource(input.resourceId)
      if (!stored) throw new Error('Prompt resource not found')
      return preview(stored, input.artifact).result
    },
    applyPromptPackageUpdate: async (input: ApplyPromptPackageUpdateInput, context?: RuntimeRequestContext): Promise<ApplyPromptPackageUpdateResult> => {
      const before = await ctx.promptResources.getResource(input.resourceId)
      if (!before) throw new Error('Prompt resource not found')
      const initial = preview(before, input.artifact)
      if (before.version !== input.expectedVersion || initial.result.fingerprint !== input.fingerprint) throw new Error('Prompt resource changed; review the package again')
      // Keeping the SQL content is a completed choice, not a write to a review ledger.
      if (input.keepLocal) return { resource: initial.local }
      if (initial.result.blockingChanges.length) throw new Error(initial.result.blockingChanges.join('\n'))
      const result = await ctx.dataEngine.transact({ ...promptResourceWriteContext(context), reason: 'application.applyPromptPackageUpdate' }, async transaction => {
        const tx = ctx.promptResources.transaction(transaction)
        let page = tx.listResources({ limit: 100 })
        let stored = page.resources.find(resource => resource.id === input.resourceId)
        while (!stored && page.nextCursor) { page = tx.listResources({ limit: 100, cursor: page.nextCursor }); stored = page.resources.find(resource => resource.id === input.resourceId) }
        if (!stored) throw new Error('Prompt resource not found')
        const current = preview(stored, input.artifact)
        if (stored.version !== input.expectedVersion || current.result.fingerprint !== input.fingerprint) throw new Error('Prompt resource changed; review the package again')
        const sourcePackage = structuredClone(current.local.sourcePackage!)
        for (const node of walk(current.artifact.rootNode)) if (!Object.hasOwn(sourcePackage.nodeIds, node.id)) {
          Object.defineProperty(sourcePackage.nodeIds, node.id, { value: ctx.createId('prompt-node'), enumerable: true, writable: true, configurable: true })
        }
        const next = toStoredResourceInput({ content: { ...current.local,
          rootNode: remap(current.artifact.rootNode, sourcePackage.nodeIds, current.anchors),
          macros: current.artifact.macros ?? {}, macroOptions: current.artifact.macroOptions ?? {},
          metadata: structuredClone(current.artifact.metadata), sourcePackage, updatedAt: ctx.now(),
        } })
        return tx.mutateResource({ resourceId: stored.id, expectedVersion: stored.version,
          mutations: [{ kind: 'tree.replace', rootNode: next.rootNode }, { kind: 'resource.update', patch: { label: next.label, metadata: next.metadata } }] })
      })
      return { resource: fromStoredResource(result.value), mutation: { changesetId: result.commit.changesetId } }
    },
  }
}
