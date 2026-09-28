import type { ClientDisplayPart, ClientRendererFrameHostMessage, RendererSurface } from '@loom-studio/extension-sdk'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { rendererContributionKey, rendererSurfacePolicies } from '../../../shared/extension-renderer-runtime/renderer-registry.js'
import type { ClientRendererContext, ClientRendererHost, ClientRendererRegistration, ClientRendererScope, ClientRendererInstanceHandle } from '../../../shared/extension-renderer-runtime/client-renderer-host.js'
import { readClientThemeSnapshot, subscribeClientTheme } from '../model/client-theme.js'
import { mountIsolatedFrame } from '../../../shared/iframe-runtime/frame-lifecycle.js'
import { isFrameRecord } from '../../../shared/iframe-runtime/frame-channel.js'
import { serveIframeContext } from '../model/iframe-ctx-bridge.js'
import styles from './renderer-surface-host.module.scss'

export function RendererSurfaceHost(props: {
  host: ClientRendererHost
  surface: RendererSurface
  scope: ClientRendererScope
  activeContributionKey?: string
  className?: string
}) {
  const revision = useSyncExternalStore(props.host.subscribe, props.host.renderRevision, props.host.renderRevision)
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
  const sandboxRef = useRef<ClientRendererInstanceHandle | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const contributionKey = rendererContributionKey(props.registration)
  const scopeSignature = JSON.stringify(props.scope)
  const stableScope = useMemo(() => structuredClone(props.scope), [scopeSignature])
  const context = useMemo<ClientRendererContext>(() => {
    const controller = new AbortController()
    return {
      identity: {
        owner: structuredClone(props.registration.owner),
        contributionId: props.registration.contributionId,
      },
      surface: props.registration.definition.surface,
      scope: stableScope,
      ...(props.part ? { part: props.part } : {}),
      host: {
        compact: globalThis.matchMedia?.('(max-width: 820px)').matches ?? false,
        prefersReducedMotion: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
        theme: 'inherit',
        themeSnapshot: readClientThemeSnapshot(),
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
    function disposeRenderer(renderer: typeof handle) {
      const report = (error: unknown) => props.host.reportDiagnostic({
        code: 'renderer.dispose_failed',
        message: error instanceof Error ? error.message : String(error),
        contributionKey,
      })
      try {
        void Promise.resolve(renderer?.dispose()).catch(report)
      } catch (error) {
        report(error)
      }
    }
    const instanceHandle = props.host.trackInstance(
      props.registration.definition.surface,
      stableScope,
      contributionKey,
    )
    setFailed(false)
    const adapter = props.registration.definition.adapter ?? 'direct'
    if (props.registration.sandboxMount) {
      const sandbox = props.registration.sandboxMount(root, context)
      handle = sandbox
      sandboxRef.current = sandbox
      const unsubscribeTheme = subscribeClientTheme(snapshot => {
        context.host.themeSnapshot = snapshot
        void Promise.resolve().then(() => {
          if (!disposed) return sandbox.update?.(context)
        }).catch(error => {
          if (disposed) return
          props.host.reportDiagnostic({
            code: 'renderer.surface_mismatch',
            message: error instanceof Error ? error.message : String(error),
            contributionKey,
          })
        })
      })
      return () => {
        disposed = true
        sandboxRef.current = undefined
        unsubscribeTheme()
        ;(context as ClientRendererContext & { controller: AbortController }).controller.abort()
        disposeRenderer(handle)
        void instanceHandle.dispose()
        root.replaceChildren()
      }
    }
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
      const channel = new MessageChannel()
      const instanceId = crypto.randomUUID()
      const requests = serveIframeContext(channel.port1, props.registration.frameNotifications, () => {
        props.host.reportDiagnostic({ code: 'renderer.sandbox_failed', message: 'Invalid iframe request envelope', contributionKey })
      })
      channel.port1.addEventListener('message', event => {
        if (!disposed && isFrameRecord(event.data) && event.data.type === 'loom:ctx.close') context.close()
      })
      const revoke = () => {
        if (disposed) return
        disposed = true
        requests.dispose()
        channel.port1.postMessage({ type: 'loom:ctx.disposed' })
        channel.port1.close()
        channel.port2.close()
        ;(context as ClientRendererContext & { controller: AbortController }).controller.abort()
      }
      const instance = mountIsolatedFrame(root, {
        title: props.registration.frame?.title ?? props.registration.definition.name,
        source: { url: source },
        onMessage: data => {
          if (!disposed && isFrameRecord(data) && data.type === 'loom:renderer-close') context.close()
        },
        onLoad: ({ frame, markReady }) => {
          markReady()
          context.host.themeSnapshot = readClientThemeSnapshot()
          frame.contentWindow?.postMessage({
            type: 'loom:ctx.connect', protocolVersion: 1, instanceId,
          }, '*', [channel.port2])
          frame.contentWindow?.postMessage({
            type: 'loom:renderer-context',
            identity: context.identity,
            surface: context.surface,
            scope: context.scope,
            part: context.part,
            host: context.host,
          } satisfies ClientRendererFrameHostMessage, '*')
        },
        onFailure: message => {
          revoke()
          setFailed(true)
          props.host.reportDiagnostic({ code: 'renderer.sandbox_failed', message, contributionKey })
        },
      })
      const frame = instance.frame
      frame.dataset.loomRendererFrame = contributionKey
      const abort = () => { revoke(); instance.dispose() }
      props.registration.frameNotifications?.signal.addEventListener('abort', abort, { once: true })
      if (props.registration.frameNotifications?.signal.aborted) abort()
      const unsubscribeTheme = subscribeClientTheme(snapshot => {
        if (disposed) return
        context.host.themeSnapshot = snapshot
        frame.contentWindow?.postMessage({ type: 'loom:renderer-theme', theme: snapshot } satisfies ClientRendererFrameHostMessage, '*')
      })
      return () => {
        revoke()
        unsubscribeTheme()
        props.registration.frameNotifications?.signal.removeEventListener('abort', abort)
        instance.dispose()
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

    const unsubscribeTheme = subscribeClientTheme(snapshot => {
      context.host.themeSnapshot = snapshot
      void Promise.resolve().then(() => {
        if (!disposed) return props.registration.update?.(context)
      }).catch(error => {
        if (disposed) return
        props.host.reportDiagnostic({
          code: 'renderer.surface_mismatch',
          message: error instanceof Error ? error.message : String(error),
          contributionKey,
        })
      })
    })

    void Promise.resolve().then(() => {
      if (!disposed) return props.registration.mount(mountRoot, context)
    }).then(result => {
      if (disposed) disposeRenderer(result)
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
      unsubscribeTheme()
      ;(context as ClientRendererContext & { controller: AbortController }).controller.abort()
      disposeRenderer(handle)
      void instanceHandle.dispose()
      if (root.shadowRoot) root.shadowRoot.replaceChildren()
      else root.replaceChildren()
    }
  }, [context, contributionKey, props.host, props.registration])

  useEffect(() => {
    const update = props.registration.sandboxMount ? sandboxRef.current?.update : props.registration.update
    if (!update) return
    let disposed = false
    void Promise.resolve().then(() => {
      if (!disposed) return update(context)
    }).catch(error => {
      if (disposed) return
      props.host.reportDiagnostic({
        code: 'renderer.surface_mismatch',
        message: error instanceof Error ? error.message : String(error),
        contributionKey,
      })
    })
    return () => { disposed = true }
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
