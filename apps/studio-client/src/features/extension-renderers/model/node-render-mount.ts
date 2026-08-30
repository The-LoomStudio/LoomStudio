import type { ClientNodeRenderMount, ClientTextSelector } from '@loom-studio/extension-sdk'
import type { ClientRendererRegistration } from './client-renderer-host.js'
import type { RendererRegistryDiagnostic } from './renderer-registry.js'
import { rendererContributionKey } from './renderer-registry.js'

export type ProjectedNodeRenderMount = {
  registration: ClientRendererRegistration
  mount: ClientNodeRenderMount
}

export type ResolvedInlineNodeRenderMount = ProjectedNodeRenderMount & {
  start: number
  end: number
  placement: 'before' | 'after' | 'replace'
}

export function resolveNodeRenderMounts(input: {
  rawText: string
  mounts: readonly ProjectedNodeRenderMount[]
  matches?: ReadonlyMap<string, { start: number; end: number }>
  markers?: ReadonlyMap<string, { start: number; end: number }>
}): {
  before: ProjectedNodeRenderMount[]
  inline: ResolvedInlineNodeRenderMount[]
  after: ProjectedNodeRenderMount[]
  diagnostics: RendererRegistryDiagnostic[]
} {
  const before: ProjectedNodeRenderMount[] = []
  const inline: ResolvedInlineNodeRenderMount[] = []
  const after: ProjectedNodeRenderMount[] = []
  const diagnostics: RendererRegistryDiagnostic[] = []
  const identities = new Set<string>()

  for (const projected of input.mounts) {
    const contributionKey = rendererContributionKey(projected.registration)
    const identity = `${contributionKey}/${projected.mount.key}`
    if (identities.has(identity)) {
      diagnostics.push({
        code: 'renderer.mount_duplicate',
        contributionKey,
        message: `Node Render Mount key is duplicated: ${projected.mount.key}`,
      })
      continue
    }
    identities.add(identity)

    if (projected.mount.target.slot === 'node.before') {
      before.push(projected)
      continue
    }
    if (projected.mount.target.slot === 'node.after') {
      after.push(projected)
      continue
    }

    const resolved = resolveSelector(input.rawText, projected.mount.target.selector, input.matches, input.markers)
    if (resolved.kind !== 'resolved') {
      diagnostics.push({
        code: resolved.kind === 'ambiguous' ? 'renderer.anchor_ambiguous' : 'renderer.anchor_unresolved',
        contributionKey,
        message: `${resolved.message}: ${projected.mount.key}`,
      })
      continue
    }
    inline.push({
      ...projected,
      start: resolved.start,
      end: resolved.end,
      placement: projected.mount.target.placement,
    })
  }

  inline.sort((left, right) => left.start - right.start
    || placementOrder(left.placement) - placementOrder(right.placement)
    || rendererContributionKey(left.registration).localeCompare(rendererContributionKey(right.registration))
    || left.mount.key.localeCompare(right.mount.key))

  let replacedUntil = -1
  const acceptedInline: ResolvedInlineNodeRenderMount[] = []
  for (const mount of inline) {
    if (mount.placement === 'replace') {
      if (mount.start < replacedUntil) {
        diagnostics.push({
          code: 'renderer.anchor_overlap',
          contributionKey: rendererContributionKey(mount.registration),
          message: `Node Render Mount replacement overlaps another replacement: ${mount.mount.key}`,
        })
        continue
      }
      replacedUntil = mount.end
    }
    acceptedInline.push(mount)
  }

  return { before, inline: acceptedInline, after, diagnostics }
}

function resolveSelector(
  text: string,
  selector: ClientTextSelector,
  matches: ReadonlyMap<string, { start: number; end: number }> | undefined,
  markers: ReadonlyMap<string, { start: number; end: number }> | undefined,
): { kind: 'resolved'; start: number; end: number } | { kind: 'unresolved' | 'ambiguous'; message: string } {
  if (selector.kind === 'match-ref') {
    const match = matches?.get(selector.matchId)
    return match
      ? { kind: 'resolved', start: match.start, end: match.end }
      : { kind: 'unresolved', message: `Match anchor was not found: ${selector.matchId}` }
  }
  if (selector.kind === 'marker') {
    const marker = markers?.get(selector.markerId)
    return marker
      ? { kind: 'resolved', start: marker.start, end: marker.end }
      : { kind: 'unresolved', message: `Marker anchor was not found: ${selector.markerId}` }
  }
  if (!selector.value) return { kind: 'unresolved', message: 'Literal anchor cannot be empty' }
  const first = text.indexOf(selector.value)
  if (first < 0) return { kind: 'unresolved', message: `Literal anchor was not found: ${selector.value}` }
  if (text.indexOf(selector.value, first + selector.value.length) >= 0) {
    return { kind: 'ambiguous', message: `Literal anchor matched more than once: ${selector.value}` }
  }
  return { kind: 'resolved', start: first, end: first + selector.value.length }
}

function placementOrder(value: ResolvedInlineNodeRenderMount['placement']): number {
  return value === 'before' ? 0 : value === 'replace' ? 1 : 2
}
