import type { ClientRendererRegistration } from '../../../shared/extension-renderer-runtime/client-renderer-host.js'
import { serveFrameRequests } from '../../../shared/iframe-runtime/frame-channel.js'
import { readClientNotification } from '../../../shared/extension-renderer-runtime/renderer-notifications.js'

export function serveIframeContext(port: MessagePort, notifications: ClientRendererRegistration['frameNotifications'], onInvalidMessage: () => void) {
  return serveFrameRequests(port, {
    onInvalidMessage,
    async handle(method, params) {
      if (method !== 'notifications.show') throw Object.assign(new Error('Unknown iframe method'), { code: 'ctx.unknown_method' })
      if (!notifications) throw Object.assign(new Error('Notification capability is unavailable'), { code: 'capability.denied' })
      notifications.signal.throwIfAborted()
      await notifications.show(readClientNotification(params))
      return null
    },
  })
}
