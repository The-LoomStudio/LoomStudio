import type {
  RendererConflictPolicy,
  RendererContributionDefinition,
  RendererContributionIdentity,
  RendererInstanceIdentity,
  RendererSurface,
} from '@loom-studio/extension-sdk'

export type RegisteredRendererContribution = RendererContributionIdentity & {
  definition: RendererContributionDefinition
}

export type RendererRegistryDiagnostic = {
  code:
    | 'renderer.duplicate'
    | 'renderer.surface_mismatch'
    | 'renderer.exclusive_occupied'
    | 'renderer.projection_failed'
    | 'renderer.mount_duplicate'
    | 'renderer.anchor_unresolved'
    | 'renderer.anchor_ambiguous'
    | 'renderer.anchor_overlap'
  message: string
  contributionKey: string
}

export const rendererSurfacePolicies: Record<RendererSurface, RendererConflictPolicy> = {
  'shell.background': 'exclusive',
  'narrative.entry.inline': 'anchored-projection',
  'narrative.timeline.tail': 'collection',
  'agent.message.inline': 'anchored-projection',
  'agent.session.tail': 'collection',
  'composer.sheet': 'exclusive',
  'shell.workspace-panel': 'navigation',
  'shell.focus-surface': 'exclusive',
  'standalone.page': 'navigation',
}

export function rendererContributionKey(identity: RendererContributionIdentity): string {
  return `${identity.packageId}/${identity.moduleId}/${identity.contributionId}`
}

export function rendererInstanceKey(identity: RendererInstanceIdentity): string {
  return `${rendererContributionKey(identity)}@${identity.scopeKey}`
}

export function orderRendererContributions(input: {
  contributions: readonly RegisteredRendererContribution[]
  surface: RendererSurface
  userOrder?: readonly string[]
}): { contributions: RegisteredRendererContribution[]; diagnostics: RendererRegistryDiagnostic[] } {
  const userOrder = new Map((input.userOrder ?? []).map((key, index) => [key, index]))
  const unique = new Map<string, RegisteredRendererContribution>()
  const diagnostics: RendererRegistryDiagnostic[] = []

  for (const contribution of input.contributions) {
    const key = rendererContributionKey(contribution)
    if (contribution.definition.surface !== input.surface) {
      diagnostics.push({
        code: 'renderer.surface_mismatch',
        message: `Renderer ${key} does not belong to surface ${input.surface}`,
        contributionKey: key,
      })
      continue
    }
    if (unique.has(key)) {
      diagnostics.push({
        code: 'renderer.duplicate',
        message: `Renderer contribution is registered more than once: ${key}`,
        contributionKey: key,
      })
      continue
    }
    unique.set(key, contribution)
  }

  return {
    contributions: [...unique.values()].sort((left, right) => {
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
    }),
    diagnostics,
  }
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
