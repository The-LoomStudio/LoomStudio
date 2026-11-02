import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { DialogPortalContext } from './dialog-portal-context.js'
import { mobileMotionDuration, mobileMotionEasing, mobileReleaseTarget, mobileResistance } from '../mobile-motion.js'
import { X } from 'lucide-react'
import { IconButton } from './icon-button.js'

export type DialogProps = {
  actions?: ReactNode
  children?: ReactNode
  className?: string
  closeOnBackdrop?: boolean
  closeLabel?: string
  description?: ReactNode
  dismissible?: boolean
  headerActions?: ReactNode
  id?: string
  layout?: 'default' | 'media' | 'workbench'
  onClose(): void | Promise<void>
  open: boolean
  mobileOpenHandle?: boolean
  onOpen?(): void
  role?: 'alertdialog' | 'dialog'
  showCloseButton?: boolean
  title: ReactNode
  titleIcon?: ReactNode
}

export function Dialog(props: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [portalContainer, setPortalContainer] = useState<HTMLDialogElement | null>(null)
  const setDialogRef = useCallback((element: HTMLDialogElement | null) => {
    dialogRef.current = element
    setPortalContainer(element)
  }, [])
  const titleId = useId()
  const descriptionId = useId()
  const dismissible = props.dismissible ?? true
  const backdropPress = useRef(false)
  const openRef = useRef(props.open)
  openRef.current = props.open
  const releaseFrame = useRef<number | undefined>(undefined)
  const sheetDrag = useRef<{ id: number; y: number; initial: number; position: number; lastY: number; time: number; velocity: number; opening?: boolean } | undefined>(undefined)
  const suppressOpenClickUntil = useRef(0)
  const sheetAnimation = useRef<Animation | undefined>(undefined)
  const sheet = props.layout !== 'media' && props.role !== 'alertdialog'
  const settleSheet = (target: number, done?: () => void) => {
    const dialog = dialogRef.current
    if (!dialog) return
    const from = getComputedStyle(dialog).transform
    const position = from === 'none' ? 0 : new DOMMatrixReadOnly(from).m42
    sheetAnimation.current?.cancel()
    dialog.style.setProperty('--loom-sheet-offset', `${position}px`)
    dialog.dataset.sheetDragging = 'true'
    const animation = dialog.animate([{ transform: from }, { transform: `translate3d(0,${target}px,0)` }], {
      duration: mobileMotionDuration(target - position, sheetDrag.current?.velocity), easing: mobileMotionEasing, fill: 'both',
    })
    sheetAnimation.current = animation
    void animation.finished.then(() => {
      if (sheetAnimation.current !== animation) return
      dialog.style.setProperty('--loom-sheet-offset', `${target}px`)
      animation.cancel()
      sheetAnimation.current = undefined
      done?.()
      // Keep the entry keyframes disabled until the native dialog is closed.
    }, () => {})
  }
  const resetSheet = () => {
    const opening = sheetDrag.current?.opening
    sheetDrag.current = undefined
    const dialog = dialogRef.current
    if (opening && dialog) settleSheet(dialog.clientHeight, () => dialog.close())
    else settleSheet(0)
  }
  const beginSheet = (event: React.PointerEvent<HTMLButtonElement>, opening = false) => {
    if (event.pointerType !== 'touch' || event.isPrimary === false) return
    const dialog = dialogRef.current
    if (!dialog) return
    if (releaseFrame.current !== undefined) cancelAnimationFrame(releaseFrame.current)
    if (opening) {
      dialog.dataset.sheetDragging = 'true'
      dialog.showModal()
      dialog.style.setProperty('--loom-sheet-offset', `${dialog.clientHeight}px`)
    }
    const transform = getComputedStyle(dialog).transform
    const initial = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42
    sheetAnimation.current?.cancel()
    sheetAnimation.current = undefined
    dialog.dataset.sheetDragging = 'true'
    dialog.style.setProperty('--loom-sheet-offset', `${initial}px`)
    sheetDrag.current = { id: event.pointerId, y: event.clientY, initial, position: initial, lastY: event.clientY, time: event.timeStamp, velocity: 0, opening }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveSheet = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = sheetDrag.current, dialog = dialogRef.current
    if (!drag || drag.id !== event.pointerId || !dialog) return
    if (event.timeStamp > drag.time) drag.velocity = (event.clientY - drag.lastY) / (event.timeStamp - drag.time)
    drag.lastY = event.clientY; drag.time = event.timeStamp
    if (drag.opening && Math.abs(event.clientY - drag.y) > 8) suppressOpenClickUntil.current = Date.now() + 400
    drag.position = mobileResistance(drag.initial + event.clientY - drag.y, 0, dialog.clientHeight)
    dialog.style.setProperty('--loom-sheet-offset', `${drag.position}px`)
  }
  const endSheet = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = sheetDrag.current, dialog = dialogRef.current
    if (!drag || drag.id !== event.pointerId || !dialog) return
    const velocity = event.timeStamp - drag.time > 120 ? 0 : drag.velocity
    const close = mobileReleaseTarget(drag.position, dialog.clientHeight, velocity)
    sheetDrag.current = undefined
    if (drag.opening) {
      suppressOpenClickUntil.current = Date.now() + 400
      if (Math.abs(drag.lastY - drag.y) < 8) { props.onOpen?.(); settleSheet(0); return }
      if (close) settleSheet(dialog.clientHeight, () => dialog.close())
      else { props.onOpen?.(); settleSheet(0) }
      return
    }
    if (!close) { settleSheet(0); return }
    const finishRequest = () => {
      releaseFrame.current = requestAnimationFrame(() => {
        releaseFrame.current = undefined
        if (openRef.current) settleSheet(0)
      })
    }
    const request = props.onClose()
    if (request) void request.then(finishRequest, finishRequest)
    else finishRequest()
  }

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (props.open && !dialog.open) {
      delete dialog.dataset.sheetDragging
      dialog.style.removeProperty('--loom-sheet-offset')
      dialog.showModal()
    } else if (!props.open && dialog.open) {
      // History navigation can close a workbench while a nested confirmation is open.
      for (const child of [...dialog.querySelectorAll<HTMLDialogElement>('dialog[open]')].reverse()) child.close()
      if (sheet && window.innerWidth <= 768 && document.documentElement.dataset.loomMotion !== 'reduce' && (document.documentElement.dataset.loomMotion === 'full' || !window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
        settleSheet(dialog.clientHeight, () => { dialog.close(); dialog.style.removeProperty('--loom-sheet-offset') })
        return () => { sheetAnimation.current?.cancel() }
      }
      dialog.close()
      dialog.style.removeProperty('--loom-sheet-offset')
    }
  }, [props.open, props.layout, sheet])

  useEffect(() => () => {
    if (releaseFrame.current !== undefined) cancelAnimationFrame(releaseFrame.current)
    sheetAnimation.current?.cancel()
    if (dialogRef.current?.open) dialogRef.current.close()
  }, [])

  return (
    <>
      {props.mobileOpenHandle && !props.open ? <button type="button" data-loom-ui-sheet-open-handle="" data-mobile-swipe="ignore" aria-label="打开 Agent Session" aria-haspopup="dialog"
        onClick={() => { if (!sheetDrag.current && Date.now() >= suppressOpenClickUntil.current) props.onOpen?.() }}
        onPointerDown={event => beginSheet(event, true)} onPointerMove={moveSheet} onPointerUp={endSheet}
        onPointerCancel={resetSheet} onLostPointerCapture={() => { if (sheetDrag.current) resetSheet() }} /> : null}
      <dialog ref={setDialogRef} id={props.id} aria-describedby={props.description ? descriptionId : undefined} aria-labelledby={titleId} className={props.className} data-mobile-sheet={sheet ? 'true' : undefined} data-layout={props.layout ?? 'default'} data-loom-ui-dialog="" role={props.role ?? 'dialog'} onCancel={event => { event.stopPropagation(); event.preventDefault(); if (dismissible) props.onClose() }} onClose={event => { event.stopPropagation(); if (event.target === event.currentTarget && props.open) props.onClose() }} onPointerDown={event => {
      backdropPress.current = event.button === 0 && event.target === event.currentTarget
        && isDialogBackdropPoint(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY)
    }} onPointerCancel={() => { backdropPress.current = false }} onClick={event => {
      const startedOnBackdrop = backdropPress.current
      backdropPress.current = false
      if (!dismissible || props.closeOnBackdrop === false || !startedOnBackdrop || event.target !== event.currentTarget) return
      if (isDialogBackdropPoint(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY)) props.onClose()
    }}>
      <DialogPortalContext.Provider value={portalContainer}>
      <div data-loom-ui-dialog-frame="">
        <header data-loom-ui-dialog-header="">
          {sheet && dismissible && props.showCloseButton !== false ? <button type="button" data-loom-ui-sheet-handle="" aria-label={props.closeLabel ?? '关闭'} onClick={event => { if (event.detail === 0) props.onClose() }}
            onPointerDown={event => beginSheet(event)} onPointerMove={moveSheet} onPointerUp={endSheet}
            onPointerCancel={resetSheet} onLostPointerCapture={() => { if (sheetDrag.current) resetSheet() }} /> : null}

          <div data-loom-ui-dialog-title-row="">
            <h2 id={titleId}>{props.titleIcon ? <span data-loom-ui-dialog-title-icon="" aria-hidden="true">{props.titleIcon}</span> : null}{props.title}</h2>
            <div data-loom-ui-dialog-header-actions="">
              {props.headerActions}
              {props.showCloseButton !== false ? <IconButton disabled={!dismissible}
                aria-label={props.closeLabel ?? '关闭'} onClick={props.onClose}>
                <X size={18} aria-hidden="true" />
              </IconButton> : null}
            </div>
          </div>
          {props.description ? <p id={descriptionId}>{props.description}</p> : null}
        </header>
        {props.children ? <div data-loom-mobile-tab-scope="" data-loom-ui-dialog-body="">{props.children}</div> : null}
        {props.actions ? <footer data-loom-ui-dialog-actions="">{props.actions}</footer> : null}
      </div>
      </DialogPortalContext.Provider>
    </dialog>
    </>
  )
}

export function isDialogBackdropPoint(rect: Pick<DOMRect, 'bottom' | 'left' | 'right' | 'top'>, clientX: number, clientY: number): boolean {
  return clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom
}
