import { useEffect, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { ClientRendererHost, ClientRendererScope } from '../model/client-renderer-host.js'
import { RendererSurfaceHost } from './renderer-surface-host.js'
import styles from './renderer-focus-surface.module.scss'

export function RendererFocusSurface(props: { host: ClientRendererHost; scope: ClientRendererScope }) {
  useSyncExternalStore(props.host.subscribe, props.host.revision, props.host.revision)
  const activeKey = props.host.activeContributionKey('shell.focus-surface', props.scope.key)
  if (!activeKey || typeof document === 'undefined') return null
  return createPortal(
    <FocusDialog activeKey={activeKey} host={props.host} scope={props.scope} />,
    document.body,
  )
}

function FocusDialog(props: { activeKey: string; host: ClientRendererHost; scope: ClientRendererScope }) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    dialog.showModal()
    return () => {
      if (dialog.open) dialog.close()
      previousFocus?.focus()
    }
  }, [])

  return (
    <dialog
      aria-label="Extension focus surface"
      className={styles.dialog}
      data-loom-component="renderer-focus-surface"
      ref={dialogRef}
      onCancel={event => {
        event.preventDefault()
        props.host.release('shell.focus-surface', props.scope.key, props.activeKey)
      }}
    >
      <RendererSurfaceHost
        activeContributionKey={props.activeKey}
        host={props.host}
        scope={props.scope}
        surface="shell.focus-surface"
      />
    </dialog>
  )
}
