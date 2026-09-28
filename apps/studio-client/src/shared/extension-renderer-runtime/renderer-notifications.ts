import type { ClientNotification } from '@loom-studio/extension-sdk'
import { isFrameRecord } from '../iframe-runtime/frame-channel.js'

export function readClientNotification(value: unknown): ClientNotification {
  if (!isFrameRecord(value) || typeof value.message !== 'string' || !value.message.trim() || value.message.length > 1000
    || (value.level !== undefined && (typeof value.level !== 'string' || !['info', 'success', 'warning', 'error'].includes(value.level)))
    || Object.keys(value).some(key => key !== 'message' && key !== 'level')) {
    throw Object.assign(new Error('Invalid plain-text notification'), { code: 'ctx.invalid_request' })
  }
  return { message: value.message, ...(value.level ? { level: value.level as ClientNotification['level'] } : {}) }
}

export function createRendererNotifications(show: (owner: string, input: ClientNotification) => void) {
  const windows = new Map<string, number[]>()
  return {
    show(owner: string, input: unknown): void {
      const notification = readClientNotification(input)
      const now = Date.now()
      for (const [key, times] of windows) {
        if (times.at(-1)! <= now - 10_000) windows.delete(key)
      }
      const recent = (windows.get(owner) ?? []).filter(time => time > now - 10_000)
      if (recent.length >= 3) throw Object.assign(new Error('Notification rate limit exceeded'), { code: 'ctx.rate_limited' })
      recent.push(now)
      windows.set(owner, recent)
      show(owner, notification)
    },
  }
}
