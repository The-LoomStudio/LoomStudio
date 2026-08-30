import type { ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { ClientRendererHost, ClientRendererRegistration } from '../model/client-renderer-host.js'
import {
  resolveNodeRenderMounts,
  type ProjectedNodeRenderMount,
  type ResolvedInlineNodeRenderMount,
} from '../model/node-render-mount.js'
import { rendererContributionKey } from '../model/renderer-registry.js'
import { RendererInstanceRoot } from './renderer-surface-host.js'
import styles from './renderer-node-mount-host.module.scss'

const MAX_NODE_MOUNTS = 64
const MAX_NODE_TEXT_CHARACTERS = 200_000

type RendererNodeMountHostProps = {
  children: ReactNode
  host: ClientRendererHost
  rawText: string
} & (
  | { surface: 'narrative'; nodeId: string; timelineId: string }
  | { surface: 'agent-message'; messageId: string; agentSessionId: string }
)

export function RendererNodeMountHost(props: RendererNodeMountHostProps) {
  const revision = useSyncExternalStore(props.host.subscribe, props.host.revision, props.host.revision)
  const contentRef = useRef<HTMLDivElement>(null)
  const entryId = props.surface === 'narrative' ? props.nodeId : props.messageId
  const ownerId = props.surface === 'narrative' ? props.timelineId : props.agentSessionId
  const rendererSurface = props.surface === 'narrative' ? 'narrative.entry.inline' : 'agent.message.inline'
  const [projection, setProjection] = useState<ReturnType<typeof resolveNodeRenderMounts>>({
    before: [],
    inline: [],
    after: [],
    diagnostics: [],
  })

  useEffect(() => {
    const registrations = props.host.list(rendererSurface).filter(hasNodeProjector)
    if (registrations.length === 0) {
      setProjection(current => current.before.length || current.inline.length || current.after.length
        ? { before: [], inline: [], after: [], diagnostics: [] }
        : current)
      return
    }
    const controller = new AbortController()
    let disposed = false
    void Promise.all(registrations.map(async registration => {
      try {
        const mounts = await registration.projectNode!(props.surface === 'narrative' ? {
          nodeId: props.nodeId,
          timelineId: props.timelineId,
          rawText: props.rawText,
          displayText: props.rawText,
          surface: 'narrative',
          signal: controller.signal,
        } : {
          messageId: props.messageId,
          agentSessionId: props.agentSessionId,
          rawText: props.rawText,
          displayText: props.rawText,
          surface: 'agent-message',
          signal: controller.signal,
        })
        return mounts.map(mount => ({ registration, mount }))
      } catch (error) {
        props.host.reportDiagnostic({
          code: 'renderer.projection_failed',
          contributionKey: rendererContributionKey(registration),
          message: error instanceof Error ? error.message : String(error),
        })
        return []
      }
    })).then(groups => {
      if (disposed) return
      const mounts = groups.flat()
      if (props.rawText.length > MAX_NODE_TEXT_CHARACTERS || mounts.length > MAX_NODE_MOUNTS) {
        const registration = mounts[0]?.registration ?? registrations[0]!
        props.host.reportDiagnostic({
          code: 'renderer.projection_failed',
          contributionKey: rendererContributionKey(registration),
          message: `Node Render Mount budget exceeded for ${entryId}`,
        })
      }
      // ponytail: v0 对单 Node 限制 64 个 Mount 和 20 万字符；真实内容证明不足后再改成可配置预算。
      const resolved = resolveNodeRenderMounts({
        rawText: props.rawText.slice(0, MAX_NODE_TEXT_CHARACTERS),
        mounts: mounts.slice(0, MAX_NODE_MOUNTS),
      })
      for (const diagnostic of resolved.diagnostics) props.host.reportDiagnostic(diagnostic)
      setProjection(resolved)
    })
    return () => {
      disposed = true
      controller.abort()
    }
  }, [entryId, ownerId, props.host, props.rawText, props.surface, rendererSurface, revision])

  const scope = props.surface === 'narrative' ? {
    kind: 'node' as const,
    key: props.nodeId,
    entity: { kind: 'narrative-node' as const, timelineId: props.timelineId, nodeId: props.nodeId },
  } : {
    kind: 'message' as const,
    key: props.messageId,
    entity: { kind: 'agent-message' as const, agentSessionId: props.agentSessionId, messageId: props.messageId },
  }

  return (
    <div className={styles.projection} data-loom-surface={rendererSurface}>
      {projection.before.map(projected => (
        <RendererInstanceRoot
          host={props.host}
          key={mountIdentity(projected, entryId)}
          part={projected.mount.part}
          registration={projected.registration}
          revision={revision}
          scope={scope}
        />
      ))}
      <div ref={contentRef}>{props.children}</div>
      {projection.inline.map(projected => (
        <InlineRendererPortal
          contentRoot={contentRef.current}
          host={props.host}
          key={mountIdentity(projected, entryId)}
          mount={projected}
          entryId={entryId}
          revision={revision}
          scope={scope}
        />
      ))}
      {projection.after.map(projected => (
        <RendererInstanceRoot
          host={props.host}
          key={mountIdentity(projected, entryId)}
          part={projected.mount.part}
          registration={projected.registration}
          revision={revision}
          scope={scope}
        />
      ))}
    </div>
  )
}

function InlineRendererPortal(props: {
  contentRoot: HTMLElement | null
  entryId: string
  host: ClientRendererHost
  mount: ResolvedInlineNodeRenderMount
  revision: number
  scope:
    | { kind: 'node'; key: string; entity: { kind: 'narrative-node'; timelineId: string; nodeId: string } }
    | { kind: 'message'; key: string; entity: { kind: 'agent-message'; agentSessionId: string; messageId: string } }
}) {
  const [target, setTarget] = useState<HTMLElement>()
  useLayoutEffect(() => {
    if (!props.contentRoot || props.mount.mount.target.slot !== 'node.inline') return
    const selector = props.mount.mount.target.selector
    if (selector.kind !== 'literal') return
    const anchor = insertLiteralMountAnchor(props.contentRoot, selector.value, props.mount.placement)
    if (!anchor) {
      props.host.reportDiagnostic({
        code: 'renderer.anchor_unresolved',
        contributionKey: rendererContributionKey(props.mount.registration),
        message: `Rendered literal anchor was not found: ${selector.value}`,
      })
      return
    }
    setTarget(anchor.element)
    return () => {
      setTarget(undefined)
      anchor.dispose()
    }
  }, [props.contentRoot, props.entryId, props.host, props.mount])

  return target ? createPortal((
    <RendererInstanceRoot
      host={props.host}
      inline
      part={props.mount.mount.part}
      registration={props.mount.registration}
      revision={props.revision}
      scope={props.scope}
    />
  ), target) : null
}

function insertLiteralMountAnchor(
  root: HTMLElement,
  literal: string,
  placement: 'before' | 'after' | 'replace',
): { element: HTMLSpanElement; dispose(): void } | undefined {
  const text = root.textContent ?? ''
  const start = text.indexOf(literal)
  if (start < 0 || text.indexOf(literal, start + literal.length) >= 0) return undefined
  const boundaries = locateTextBoundaries(root, start, start + literal.length)
  if (!boundaries) return undefined
  const range = document.createRange()
  range.setStart(boundaries.start.node, boundaries.start.offset)
  range.setEnd(boundaries.end.node, boundaries.end.offset)
  const element = document.createElement('span')
  element.dataset.loomRenderMount = 'true'
  let replaced: DocumentFragment | undefined
  if (placement === 'before') range.collapse(true)
  else if (placement === 'after') range.collapse(false)
  else replaced = range.extractContents()
  range.insertNode(element)
  return {
    element,
    dispose: () => {
      if (!element.isConnected) return
      if (replaced) element.replaceWith(replaced)
      else element.remove()
    },
  }
}

function locateTextBoundaries(root: HTMLElement, start: number, end: number): {
  start: { node: Text; offset: number }
  end: { node: Text; offset: number }
} | undefined {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let offset = 0
  let startBoundary: { node: Text; offset: number } | undefined
  let endBoundary: { node: Text; offset: number } | undefined
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const next = offset + node.data.length
    if (!startBoundary && start >= offset && start <= next) startBoundary = { node, offset: start - offset }
    if (end >= offset && end <= next) {
      endBoundary = { node, offset: end - offset }
      break
    }
    offset = next
  }
  return startBoundary && endBoundary ? { start: startBoundary, end: endBoundary } : undefined
}

function hasNodeProjector(registration: ClientRendererRegistration): registration is ClientRendererRegistration & Required<Pick<ClientRendererRegistration, 'projectNode'>> {
  return typeof registration.projectNode === 'function'
}

function mountIdentity(projected: ProjectedNodeRenderMount, nodeId: string): string {
  return `${rendererContributionKey(projected.registration)}/${projected.mount.key}@${nodeId}`
}
