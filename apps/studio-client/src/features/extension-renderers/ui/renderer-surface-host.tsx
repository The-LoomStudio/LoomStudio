import type { ClientDisplayPart, RendererSurface } from '@loom-studio/extension-sdk'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { rendererContributionKey, rendererSurfacePolicies } from '../model/renderer-registry.js'
import type { ClientRendererContext, ClientRendererHost, ClientRendererRegistration, ClientRendererScope } from '../model/client-renderer-host.js'
import styles from './renderer-surface-host.module.scss'

export function RendererSurfaceHost(props: {
  host: ClientRendererHost
  surface: RendererSurface
  scope: ClientRendererScope
  activeContributionKey?: string
  className?: string
}) {
  const revision = useSyncExternalStore(props.host.subscribe, props.host.revision, props.host.revision)
  const registrations = props.host.list(props.surface).filter(registration => registration.definition.instanceScope === props.scope.kind)
  const policy = rendererSurfacePolicies[props.surface]
  const activeKey = props.activeContributionKey ?? props.host.activeContributionKey(props.surface, props.scope.key)
  const visible = policy === 'collection' || policy === 'anchored-projection'
    ? registrations
    : activeKey ? registrations.filter(registration => rendererContributionKey(registration) === activeKey) : []
  if (visible.length === 0) return null

  return (
    <section
      className={[styles.surface, props.className].filter(Boolean).join(' ')}
      data-loom-component="renderer-surface-host"
      data-renderer-policy={policy}
      data-renderer-surface={props.surface}
    >
      {visible.map(registration => (
        <RendererInstanceRoot
          host={props.host}
          key={`${rendererContributionKey(registration)}@${props.scope.key}`}
          registration={registration}
          revision={revision}
          scope={props.scope}
        />
      ))}
    </section>
  )
}

export function RendererInstanceRoot(props: {
  host: ClientRendererHost
  inline?: boolean
  part?: ClientDisplayPart
  registration: ClientRendererRegistration
  revision: number
  scope: ClientRendererScope
}) {
  const rootRef = useRef<HTMLElement>(null)
  const [failed, setFailed] = useState(false)
  const contributionKey = rendererContributionKey(props.registration)
  const scopeSignature = JSON.stringify(props.scope)
  const stableScope = useMemo(() => structuredClone(props.scope), [scopeSignature])
  const context = useMemo<ClientRendererContext>(() => {
    const controller = new AbortController()
    return {
      identity: {
        packageId: props.registration.packageId,
        moduleId: props.registration.moduleId,
        contributionId: props.registration.contributionId,
      },
      surface: props.registration.definition.surface,
      scope: stableScope,
      ...(props.part ? { part: props.part } : {}),
      host: {
        compact: globalThis.matchMedia?.('(max-width: 820px)').matches ?? false,
        prefersReducedMotion: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
        theme: 'inherit',
      },
      signal: controller.signal,
      close: () => props.host.release(props.registration.definition.surface, stableScope.key, contributionKey),
      controller,
    } as ClientRendererContext & { controller: AbortController }
  }, [contributionKey, props.host, props.part, props.registration, stableScope])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let disposed = false
    let handle: void | { dispose(): void | Promise<void> }
    const instanceHandle = props.host.trackInstance(
      props.registration.definition.surface,
      stableScope,
      contributionKey,
    )
    setFailed(false)
    const adapter = props.registration.definition.adapter ?? 'direct'
    if (adapter === 'sandbox-iframe') {
      const source = props.registration.frame?.src
      if (!source) {
        setFailed(true)
        props.host.reportDiagnostic({
          code: 'renderer.projection_failed',
          message: `Sandbox iframe Renderer requires frame.src: ${contributionKey}`,
          contributionKey,
        })
        return () => { void instanceHandle.dispose() }
      }
      const frame = document.createElement('iframe')
      frame.title = props.registration.frame?.title ?? props.registration.definition.name
      frame.sandbox.add('allow-scripts')
      frame.referrerPolicy = 'no-referrer'
      frame.src = source
      frame.dataset.loomRendererFrame = contributionKey
      const handleMessage = (event: MessageEvent) => {
        if (event.source !== frame.contentWindow || !event.data || typeof event.data !== 'object') return
        if (event.data.type === 'loom:renderer-close') context.close()
      }
      window.addEventListener('message', handleMessage)
      frame.addEventListener('load', () => frame.contentWindow?.postMessage({
        type: 'loom:renderer-context',
        identity: context.identity,
        surface: context.surface,
        scope: context.scope,
        part: context.part,
        host: context.host,
      }, '*'))
      root.replaceChildren(frame)
      return () => {
        disposed = true
        window.removeEventListener('message', handleMessage)
        frame.src = 'about:blank'
        root.replaceChildren()
        void instanceHandle.dispose()
      }
    }

    let mountRoot = root
    if (adapter === 'shadow') {
      const shadow = root.shadowRoot ?? root.attachShadow({ mode: 'open' })
      const style = document.createElement('style')
      style.textContent = ':host{display:block;min-width:0;color:var(--loom-color-text);font:inherit}*,*::before,*::after{box-sizing:border-box}'
      mountRoot = document.createElement('div')
      mountRoot.dataset.loomRendererShadowRoot = contributionKey
      shadow.replaceChildren(style, mountRoot)
    }

    void Promise.resolve().then(() => props.registration.mount(mountRoot, context)).then(result => {
      if (disposed) void result?.dispose()
      else handle = result
    }).catch(error => {
      if (disposed) return
      setFailed(true)
      props.host.reportDiagnostic({
        code: 'renderer.surface_mismatch',
        message: error instanceof Error ? error.message : String(error),
        contributionKey,
      })
    })
    return () => {
      disposed = true
      ;(context as ClientRendererContext & { controller: AbortController }).controller.abort()
      void handle?.dispose()
      void instanceHandle.dispose()
      if (root.shadowRoot) root.shadowRoot.replaceChildren()
      else root.replaceChildren()
    }
  }, [context, contributionKey, props.host, props.registration])

  useEffect(() => {
    if (!props.registration.update) return
    void Promise.resolve(props.registration.update(context)).catch(error => {
      props.host.reportDiagnostic({
        code: 'renderer.surface_mismatch',
        message: error instanceof Error ? error.message : String(error),
        contributionKey,
      })
    })
  }, [context, contributionKey, props.host, props.registration, props.revision])

  const rootProps = {
    'aria-live': failed ? 'polite' as const : undefined,
    className: styles.instance,
    'data-renderer-id': contributionKey,
    'data-renderer-state': failed ? 'failed' : 'active',
    ref: (element: HTMLElement | null) => { rootRef.current = element },
  }
  const content = failed ? <span className={styles.error}>Renderer failed</span> : null
  return props.inline ? (
    <span
      {...rootProps}
      data-renderer-layout="inline"
    >
      {content}
    </span>
  ) : (
    <div
      {...rootProps}
    >
      {content}
    </div>
  )
}
