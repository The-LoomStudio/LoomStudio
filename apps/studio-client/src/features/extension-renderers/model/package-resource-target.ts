import { extensionInstallationId, installedExtensionContributionId } from '@loom-studio/extension-sdk'
import type { ManagedExtensionPackage, PromptResource } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { PackageResourceEntry } from './package-resource-preview.js'

/** Resolve installed identities without importing resources or changing adoption. */
export async function resolvePackageResourceTarget(input: {
  pkg: ManagedExtensionPackage
  entry: Pick<PackageResourceEntry, 'id' | 'kind'>
  api: Pick<StudioApi, 'loomScripts' | 'textTransforms' | 'agentTools'>
  promptResources: PromptResource[]
}): Promise<{ resource: PromptResource } | { path: string } | undefined> {
  const { pkg, entry, api } = input
  const target = pkg.target ?? { kind: 'global' as const }
  const installationId = extensionInstallationId(pkg.packageId, target)
  const matches = (origin?: { packageId: string; contributionId: string; installationId?: string }) => origin?.packageId === pkg.packageId
    && origin.contributionId === entry.id && (origin.installationId === installationId || !origin.installationId && target.kind === 'global')
  if (entry.kind === 'preset' || entry.kind === 'lore' || entry.kind === 'prompt') {
    const resource = input.promptResources.find(item => item.origin?.kind === 'extension-package' && matches(item.origin))
    return resource ? { resource } : undefined
  }
  if (entry.kind === 'theme' || entry.kind === 'style' || entry.kind === 'background') return { path: '/studio/settings?category=appearance' }
  if (entry.kind === 'script') {
    const id = installedExtensionContributionId(pkg.packageId, target, `${pkg.packageId}/script/${entry.id}`)
    const { script } = await api.loomScripts.getSummary(id)
    if (!script) return undefined
    const filter = script.contributionKinds.includes('text-transform') ? 'rules' : 'runtime'
    return { path: `/studio/extensions?extensionView=scripts&scriptFilter=${filter}&scriptId=${encodeURIComponent(script.id)}` }
  }
  if (entry.kind === 'rule') {
    const rule = (await api.textTransforms.listRuleSummaries()).rules.find(item => matches(item.origin))
    return rule ? { path: `/studio/extensions?extensionView=scripts&scriptFilter=rules&scriptId=${encodeURIComponent(rule.id)}` } : undefined
  }
  if (entry.kind === 'extractor') {
    const extractor = (await api.textTransforms.listExtractorSummaries()).extractors.find(item => matches(item.origin))
    return extractor ? { path: `/studio/extensions?extensionView=scripts&scriptFilter=rules&ruleInspector=1` } : undefined
  }
  const id = installedExtensionContributionId(pkg.packageId, target, entry.id)
  const { tool } = await api.agentTools.getSummary(id)
  return tool ? { path: `/studio/agents?toolId=${encodeURIComponent(tool.id)}` } : undefined
}
