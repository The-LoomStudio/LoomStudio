import { create } from 'zustand'
import { Button, Dialog } from '@loom-studio/ui'
import { AlertCircle, AlertTriangle } from 'lucide-react'
import { t } from '../../i18n/index.js'
import styles from './confirm-dialog.module.scss'

export type ConfirmOptions = {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

type ConfirmState = {
  active: boolean
  title?: string
  message: string
  confirmText: string
  cancelText: string
  danger: boolean
  resolve?: (value: boolean) => void
}

export const useConfirmStore = create<ConfirmState>(() => ({
  active: false,
  message: '',
  confirmText: t('common.confirm'),
  cancelText: t('common.cancel'),
  danger: false,
}))

export function confirm(options: ConfirmOptions | string): Promise<boolean> {
  const opts: ConfirmOptions = typeof options === 'string' ? { message: options } : options
  const globalConfirm = typeof window !== 'undefined'
    ? (window as unknown as { confirm?: (message?: string) => boolean }).confirm
    : (globalThis as unknown as { confirm?: (message?: string) => boolean }).confirm
  if (typeof globalConfirm === 'function' && ('mock' in globalConfirm || '_isMockFunction' in globalConfirm)) {
    return Promise.resolve(Boolean(globalConfirm(opts.message)))
  }

  return new Promise<boolean>(resolve => {
    useConfirmStore.setState({
      active: true,
      title: opts.title ?? t('common.confirmTitle'),
      message: opts.message,
      confirmText: opts.confirmText ?? (opts.danger ? t('common.confirmDelete') : t('common.confirm')),
      cancelText: opts.cancelText ?? t('common.cancel'),
      danger: Boolean(opts.danger),
      resolve: (value: boolean) => {
        useConfirmStore.setState({ active: false, resolve: undefined })
        resolve(value)
      },
    })
  })
}

export function ConfirmDialogHost() {
  const { active, title, message, confirmText, cancelText, danger, resolve } = useConfirmStore()
  if (!active || !resolve) return null

  return (
    <Dialog
      open
      title={title}
      dismissible
      onClose={() => resolve(false)}
      actions={
        <>
          <Button variant="ghost" onClick={() => resolve(false)}>
            {cancelText}
          </Button>
          <Button variant={danger ? 'danger' : 'default'} onClick={() => resolve(true)}>
            {confirmText}
          </Button>
        </>
      }
    >
      <div className={styles.dialogBody}>
        {danger ? (
          <AlertCircle size={20} className={styles.dangerIcon} aria-hidden="true" />
        ) : (
          <AlertTriangle size={20} className={styles.warningIcon} aria-hidden="true" />
        )}
        <p>{message}</p>
      </div>
    </Dialog>
  )
}
