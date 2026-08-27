import { Toaster } from 'sonner'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import 'sonner/dist/styles.css'
import { tryWriteClipboardText } from '../../browser/clipboard.js'
import styles from './notification-toaster.module.scss'

export function NotificationToaster(props: { label: string }) {
  function preventToastDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const target = event.target as Element
    if (target.closest('button')) return
    if (target.closest('[data-sonner-toast]')) event.stopPropagation()
  }

  function copyToast(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target as Element
    if (target.closest('button') || globalThis.getSelection?.()?.toString()) return
    const toast = target.closest('[data-sonner-toast]')
    const content = toast ? readToastCopyText(toast) : ''
    if (content) void tryWriteClipboardText(content)
  }

  return (
    <div onClick={copyToast} onPointerDownCapture={preventToastDrag}>
      <Toaster
        closeButton
        containerAriaLabel={props.label}
        duration={8000}
        gap={8}
        mobileOffset={{ top: 12, right: 12, left: 12 }}
        offset={{ top: 16 }}
        position="top-center"
        swipeDirections={[]}
        theme="dark"
        toastOptions={{
          unstyled: true,
          classNames: {
            actionButton: styles.actionButton,
            cancelButton: styles.cancelButton,
            closeButton: styles.closeButton,
            content: styles.content,
            description: styles.description,
            error: styles.error,
            icon: styles.icon,
            info: styles.info,
            success: styles.success,
            title: styles.title,
            toast: styles.toast,
            warning: styles.warning,
          },
        }}
        visibleToasts={4}
      />
    </div>
  )
}

export function readToastCopyText(toast: Element): string {
  return [toast.querySelector('[data-title]')?.textContent, toast.querySelector('[data-description]')?.textContent]
    .map(value => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join('\n')
}
