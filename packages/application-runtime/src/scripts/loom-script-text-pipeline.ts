import type { DocumentTransaction } from '@loom-studio/document-store'
import { resolveLoomScriptSettings, resolveTextTransformContributionRule, resolveTextExtractorContribution } from '@loom-studio/shared/loom-scripts'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import type { LoomScriptMountTarget } from './loom-script-contracts.js'
import { scriptTextResourceOrigin } from './loom-script-text-migration.js'
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
    const adopted = mount.content.adoptedDocumentVersion ?? mount.content.pinnedDocumentVersion
    const script = await readLoomScriptRevision(ctx.documents, mount.content.scriptDocumentId, adopted)
    if (!script) {
      if (mount.content.enabled) diagnostics.push({ code: 'script.missing', message: `Script revision unavailable: ${mount.content.scriptDocumentId}` })
      continue
    }
    const content = script.content
    const legacyDefault = mount.content.origin.legacyPresetInheritance === true
    if (content.owner.kind === 'extension' && !isExtensionResourceAvailable({ kind: 'extension-package', packageId: content.owner.packageId, installationId: content.owner.installationId }, installations)) continue
    const settings = mount.content.adoptedSettings ?? resolveLoomScriptSettings(content.settings ?? [], {})
    for (const contribution of content.contributions) {
      if (contribution.kind === 'renderer') continue
      const id = content.textResourceIds?.[contribution.id] ?? `${script.id}:${contribution.id}`
      const enabled = mount.content.enabled
      if (!enabled && !legacyDefault) continue
      if (contribution.requiresCode) {
        const state = executionStates.get(ctx.documents)?.get(mount.id)
        if (content.runtime !== 'server' || !state?.active || state.revision !== (mount.content.runtimeRevision ?? mount.version)) {
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
          const rule = resolveTextTransformContributionRule(contribution, settings)
          rules.push({ ...rule, ...common, enabled: enabled && rule.enabled, orderIndex: mount.content.origin.legacyRuleId ? mount.content.orderIndex : mount.content.orderIndex + rule.orderIndex })
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
