import { useEffect, useId, useRef, type ReactNode } from 'react'
import { isDialogBackdropPoint } from './dialog-model.js'
import styles from './dialog.module.scss'

type DialogProps = {
  actions?: ReactNode
  children?: ReactNode
  className?: string
  closeOnBackdrop?: boolean
  description?: ReactNode
  dismissible?: boolean
  onClose(): void
  open: boolean
  role?: 'alertdialog' | 'dialog'
  title: ReactNode
}

export function Dialog(props: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()
  const dismissible = props.dismissible ?? true

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (props.open && !dialog.open) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      dialog.showModal()
    } else if (!props.open && dialog.open) {
      dialog.close()
      restoreFocus(returnFocusRef)
    }
  }, [props.open])

  useEffect(() => () => {
    if (dialogRef.current?.open) dialogRef.current.close()
    restoreFocus(returnFocusRef)
  }, [])

  return (
    <dialog
      ref={dialogRef}
      aria-describedby={props.description ? descriptionId : undefined}
      aria-labelledby={titleId}
      className={`${styles.dialog}${props.className ? ` ${props.className}` : ''}`}
      data-loom-component="dialog"
      role={props.role ?? 'dialog'}
      onCancel={event => {
        event.preventDefault()
        if (dismissible) props.onClose()
      }}
      onClose={() => {
        if (props.open) props.onClose()
        restoreFocus(returnFocusRef)
      }}
      onPointerDown={event => {
        if (!dismissible || !props.closeOnBackdrop || event.target !== event.currentTarget) return
        if (isDialogBackdropPoint(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY)) props.onClose()
      }}
    >
      <div className={styles.frame}>
        <header className={styles.header}>
          <h2 id={titleId}>{props.title}</h2>
          {props.description ? <p id={descriptionId}>{props.description}</p> : null}
        </header>
        {props.children ? <div className={styles.body}>{props.children}</div> : null}
        {props.actions ? <footer className={styles.actions}>{props.actions}</footer> : null}
      </div>
    </dialog>
  )
}

function restoreFocus(returnFocusRef: { current: HTMLElement | null }) {
  const target = returnFocusRef.current
  returnFocusRef.current = null
  if (!target?.isConnected) return
  queueMicrotask(() => {
    if (target.isConnected) target.focus()
  })
}
