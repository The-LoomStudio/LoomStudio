import { useEffect, useId, useRef, type ReactNode } from 'react'

export type DialogProps = {
  actions?: ReactNode
  children?: ReactNode
  className?: string
  closeOnBackdrop?: boolean
  description?: ReactNode
  dismissible?: boolean
  headerActions?: ReactNode
  layout?: 'default' | 'media'
  onClose(): void
  open: boolean
  role?: 'alertdialog' | 'dialog'
  title: ReactNode
}

export function Dialog(props: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const dismissible = props.dismissible ?? true

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (props.open && !dialog.open) {
      dialog.showModal()
    } else if (!props.open && dialog.open) {
      dialog.close()
    }
  }, [props.open])

  useEffect(() => () => {
    if (dialogRef.current?.open) dialogRef.current.close()
  }, [])

  return (
      <dialog ref={dialogRef} aria-describedby={props.description ? descriptionId : undefined} aria-labelledby={titleId} className={props.className} data-layout={props.layout ?? 'default'} data-loom-ui-dialog="" role={props.role ?? 'dialog'} onCancel={event => { event.preventDefault(); if (dismissible) props.onClose() }} onClose={() => { if (props.open) props.onClose() }} onPointerDown={event => {
      if (!dismissible || !props.closeOnBackdrop || event.target !== event.currentTarget) return
      if (isDialogBackdropPoint(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY)) props.onClose()
    }}>
      <div data-loom-ui-dialog-frame="">
        <header data-loom-ui-dialog-header="">
          {props.headerActions ? <div data-loom-ui-dialog-title-row=""><h2 id={titleId}>{props.title}</h2><div data-loom-ui-dialog-header-actions="">{props.headerActions}</div></div> : <h2 id={titleId}>{props.title}</h2>}
          {props.description ? <p id={descriptionId}>{props.description}</p> : null}
        </header>
        {props.children ? <div data-loom-ui-dialog-body="">{props.children}</div> : null}
        {props.actions ? <footer data-loom-ui-dialog-actions="">{props.actions}</footer> : null}
      </div>
    </dialog>
  )
}

export function isDialogBackdropPoint(rect: Pick<DOMRect, 'bottom' | 'left' | 'right' | 'top'>, clientX: number, clientY: number): boolean {
  return clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom
}
