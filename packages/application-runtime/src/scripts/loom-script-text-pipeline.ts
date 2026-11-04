import type { DocumentTransaction } from '@loom-studio/document-store'
import { applyTextRuleUsage, resolveTextTransformContributionRule, resolveTextExtractorContribution } from '@loom-studio/shared/loom-scripts'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import type { LoomScriptMountTarget } from './loom-script-contracts.js'
import { scriptTextResourceOrigin } from './script-text-resources.js'
import { readLoomScriptRevision, selectEffectiveLoomScriptMounts } from './loom-script-resolution.js'
import type { TextTransformRuleEntry, TextExtractorEntry, TextRuleOwner, TextTransformDiagnostic } from '../transforms/history-text.js'
import { isExtensionResourceAvailable, readAvailableExtensionInstallations } from '../runtime/extension-resource-access.js'

// Runtime readiness belongs to the live host, never to saved Script metadata.
const executionStates = new WeakMap<DocumentTransaction, Map<string, { revision: number; active: boolean }>>()
export function setScriptExecutionStates(documents: DocumentTransaction, states: Array<{ mountId: string; revision: number; active: boolean }>): void {
  executionStates.set(documents, new Map(states.map(state => [state.mountId, state])))
}

export async function resolveScriptTextContributions(ctx: Pick<ApplicationRuntimeContext, 'documents'>, input: {
  cardId?: string; presetId?: string; workspaceId?: string; timelineId?: string | null
}) {
  const targets: LoomScriptMountTarget[] = [{ kind: 'user' },
    ...(input.workspaceId ? [{ kind: 'workspace' as const, workspaceId: input.workspaceId }] : []),
    ...(input.presetId ? [{ kind: 'preset' as const, presetId: input.presetId }] : []),
    ...(input.cardId ? [{ kind: 'card' as const, cardId: input.cardId }] : []),
  ]
  const mounts = await selectEffectiveLoomScriptMounts(ctx.documents, targets)
  const installations = await readAvailableExtensionInstallations(ctx.documents, input.cardId, input.timelineId)
  const rules: TextTransformRuleEntry[] = []
  const extractors: TextExtractorEntry[] = []
  const diagnostics: TextTransformDiagnostic[] = []
  for (const mount of mounts) {
    if (!mount.content.enabled) continue
    const adopted = mount.content.adoptedDocumentVersion!
    const script = await readLoomScriptRevision(ctx.documents, mount.content.scriptDocumentId, adopted)
    if (!script) {
      if (mount.content.enabled) diagnostics.push({ code: 'script.missing', message: `Script revision unavailable: ${mount.content.scriptDocumentId}` })
      continue
    }
    const content = script.content
    if (content.owner.kind === 'extension' && !isExtensionResourceAvailable({ kind: 'extension-package', packageId: content.owner.packageId, installationId: content.owner.installationId }, installations)) continue
    const settings = mount.content.adoptedSettings!
    for (const contribution of content.contributions) {
      if (contribution.kind === 'renderer') continue
      const id = content.textResourceIds?.[contribution.id] ?? `${script.id}:${contribution.id}`
      const enabled = mount.content.enabled
      if (contribution.requiresCode) {
        const state = executionStates.get(ctx.documents)?.get(mount.id)
        if (content.runtime !== 'server' || !state?.active || state.revision !== mount.content.runtimeRevision) {
          diagnostics.push({ code: 'script.code_dependency_unavailable', ruleId: id, message: content.runtime === 'server'
            ? `Contribution ${id} requires its server script to be active at the adopted revision`
            : `Contribution ${id} depends on browser code, which cannot provide a server text-pipeline dependency; use a server runtime` })
          continue
        }
      }
      try {
        const common = {
          id, version: script.version, scriptDocumentId: script.id, contributionId: contribution.id,
          owner: content.textResourceOwner ?? targetOwner(mount.content.target),
          ...(content.textResourceOrigin ? { origin: scriptTextResourceOrigin(content, contribution.id) } : {}),
          createdAt: content.createdAt, updatedAt: content.updatedAt,
        }
        if (contribution.kind === 'text-transform') {
          const rule = applyTextRuleUsage(resolveTextTransformContributionRule(contribution, settings), mount.content.ruleUsage?.[contribution.id])
          rules.push({ ...rule, ...common,
            ...(rule.loreRefs ? { loreRefs: rule.loreRefs.map(ref => ({ ...ref, nodeId: content.loreNodeReferences?.[ref.nodeId] ?? ref.nodeId, resourceId: content.loreResourceReferences?.[ref.resourceId] ?? ref.resourceId })) } : {}), enabled: enabled && rule.enabled, orderIndex: mount.content.orderIndex, localOrder: rule.orderIndex, orderOverridden: mount.content.origin.orderOverride === true, orderGroupExplicit: typeof mount.content.origin.groupOrder === 'number', orderGroupKey: JSON.stringify(content.owner), orderGroup: typeof mount.content.origin.groupOrder === 'number' ? mount.content.origin.groupOrder : mount.content.target.kind === 'preset' ? 0 : mount.content.target.kind === 'card' ? 1 : content.owner.kind === 'extension' ? 2 : 3 })
        } else {
          const extractor = resolveTextExtractorContribution(contribution, settings)
          extractors.push({ ...extractor, ...common, enabled: enabled && extractor.enabled, orderIndex: mount.content.orderIndex + extractor.orderIndex })
        }
      } catch (error) {
        diagnostics.push({ code: 'script.contribution_invalid', ruleId: id, message: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  return { rules, extractors, diagnostics }
}
function targetOwner(target: LoomScriptMountTarget): TextRuleOwner {
  if (target.kind === 'user') return { kind: 'user-override' }
  if (target.kind === 'workspace') return { kind: 'workspace' }
  return target
}
