import { useNotificationDetails } from './notification-details-store.js'
import { toast } from 'sonner'
import type { Translator } from '../i18n/index.js'
import { formatProviderErrorMessage } from './provider-error.js'

export type NotifyOptions = {
  id?: string
  description?: string
  details?: string
  duration?: number
  action?: {
    label: string
    onClick: () => void
  }
}

export const notify = {
  failure(title: string, error: unknown, options?: NotifyOptions): string | number {
    return notify.error(title, { ...options, details: error instanceof Error ? error.message : String(error) })
  },
  success(message: string, options?: NotifyOptions): string | number {
    return toast.success(message, {
      id: options?.id,
      description: options?.description,
      duration: options?.duration,
      action: options?.action,
      cancel: options?.details ? { label: '详情', onClick: () => useNotificationDetails.getState().open(message, options.details!) } : undefined,
    })
  },

  error(message: string, options?: NotifyOptions): string | number {
    return toast.error(message, {
      id: options?.id,
      description: options?.description,
      duration: options?.duration ?? 6000,
      action: options?.action,
      cancel: options?.details ? { label: '详情', onClick: () => useNotificationDetails.getState().open(message, options.details!) } : undefined,
    })
  },

  warning(message: string, options?: NotifyOptions): string | number {
    return toast.warning(message, {
      id: options?.id,
      description: options?.description,
      duration: options?.duration,
      action: options?.action,
      cancel: options?.details ? { label: '详情', onClick: () => useNotificationDetails.getState().open(message, options.details!) } : undefined,
    })
  },

  info(message: string, options?: NotifyOptions): string | number {
    return toast.info(message, {
      id: options?.id,
      description: options?.description,
      duration: options?.duration,
      action: options?.action,
      cancel: options?.details ? { label: '详情', onClick: () => useNotificationDetails.getState().open(message, options.details!) } : undefined,
    })
  },

  providerError(error: unknown, t?: Translator, options?: NotifyOptions): string | number {
    const formatted = formatProviderErrorMessage(error, t)
    return toast.error(formatted.title, {
      id: options?.id ?? 'provider-error-active',
      description: options?.description,
      duration: options?.duration ?? 8000,
      action: options?.action,
      cancel: (options?.details ?? formatted.description) ? { label: '详情', onClick: () => useNotificationDetails.getState().open(formatted.title, options?.details ?? formatted.description!) } : undefined,
    })
  },

  dismiss(id?: string | number): void {
    toast.dismiss(id)
  },
}
