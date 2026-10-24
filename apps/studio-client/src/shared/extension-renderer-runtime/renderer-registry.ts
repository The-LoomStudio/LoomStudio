import type {
  RendererConflictPolicy,
  RendererContributionDefinition,
  RendererContributionRef,
  RendererInstanceIdentity,
  RendererSurface,
} from '@loom-studio/extension-sdk'
import { extensionInstallationId } from '@loom-studio/extension-sdk'

export type RegisteredRendererContribution = RendererContributionRef & {
  definition: RendererContributionDefinition
}

export type RendererRegistryDiagnostic = {
  code:
    | 'renderer.surface_mismatch'
    | 'renderer.exclusive_occupied'
    | 'renderer.projection_failed'
    | 'renderer.dispose_failed'
    | 'renderer.mount_duplicate'
    | 'renderer.anchor_unresolved'
    | 'renderer.anchor_ambiguous'
    | 'renderer.anchor_overlap'
    | 'renderer.script_export_mismatch'
    | 'renderer.sandbox_failed'
  message: string
  contributionKey: string
}

export const rendererSurfacePolicies: Record<RendererSurface, RendererConflictPolicy> = {
  'shell.background': 'exclusive',
  'narrative.entry.inline': 'anchored-projection',
  'narrative.timeline.tail': 'collection',
  'memory.panel': 'collection',
  'agent.message.inline': 'anchored-projection',
  'agent.session.tail': 'collection',
  'composer.sheet': 'exclusive',
  'shell.workspace-panel': 'navigation',
  'shell.focus-surface': 'exclusive',
  'standalone.page': 'navigation',
}

export function rendererContributionKey(identity: RendererContributionRef): string {
  const contributionId = encodeURIComponent(identity.contributionId)
  if (identity.owner.kind === 'extension') {
    const ownerId = identity.owner.target?.kind === 'card'
      ? extensionInstallationId(identity.owner.packageId, identity.owner.target)
      : identity.owner.packageId
    return `extension:${encodeURIComponent(ownerId)}/${encodeURIComponent(identity.owner.moduleId)}/${contributionId}`
  }
  const mount = identity.owner.mountId ? `:${encodeURIComponent(identity.owner.mountId)}` : ''
  return `script:${encodeURIComponent(identity.owner.scriptDocumentId)}${mount}@${identity.owner.documentVersion}/${contributionId}`
}

export function rendererInstanceKey(identity: RendererInstanceIdentity): string {
  return `${rendererContributionKey(identity)}@${identity.scopeKey}`
}

export function orderRendererContributions<T extends RegisteredRendererContribution>(input: {
  contributions: readonly T[]
  surface: RendererSurface
  userOrder?: readonly string[]
}): T[] {
  const userOrder = new Map((input.userOrder ?? []).map((key, index) => [key, index]))
  return input.contributions
    .filter(contribution => contribution.definition.surface === input.surface)
    .sort((left, right) => {
      const leftKey = rendererContributionKey(left)
      const rightKey = rendererContributionKey(right)
      const leftUserOrder = userOrder.get(leftKey)
      const rightUserOrder = userOrder.get(rightKey)
      if (leftUserOrder !== undefined || rightUserOrder !== undefined) {
        if (leftUserOrder === undefined) return 1
        if (rightUserOrder === undefined) return -1
        if (leftUserOrder !== rightUserOrder) return leftUserOrder - rightUserOrder
      }
      const suggested = (left.definition.suggestedOrder ?? 0) - (right.definition.suggestedOrder ?? 0)
      return suggested || leftKey.localeCompare(rightKey)
    })
}

export function claimExclusiveRenderer(input: {
  surface: RendererSurface
  currentContributionKey?: string
  requestedContributionKey: string
  replace?: boolean
}):
  | { accepted: true; contributionKey: string; replacedContributionKey?: string }
  | { accepted: false; diagnostic: RendererRegistryDiagnostic } {
  if (rendererSurfacePolicies[input.surface] !== 'exclusive') {
    return { accepted: true, contributionKey: input.requestedContributionKey }
  }
  if (!input.currentContributionKey || input.currentContributionKey === input.requestedContributionKey) {
    return { accepted: true, contributionKey: input.requestedContributionKey }
  }
  if (input.replace) {
    return {
      accepted: true,
      contributionKey: input.requestedContributionKey,
      replacedContributionKey: input.currentContributionKey,
    }
  }
  return {
    accepted: false,
    diagnostic: {
      code: 'renderer.exclusive_occupied',
      message: `Renderer surface ${input.surface} is occupied by ${input.currentContributionKey}`,
      contributionKey: input.requestedContributionKey,
    },
  }
}
