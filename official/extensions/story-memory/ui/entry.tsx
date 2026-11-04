import React from 'react'
import { createRoot } from 'react-dom/client'
import type { ClientExtensionActivationContext } from '@loom-studio/extension-sdk'
import { StoryMemoryPanel } from './panel.js'
import panelCss from './panel.module.css?inline'

export function activate(ctx: ClientExtensionActivationContext) {
  ctx.renderers.register({ id: 'memory', name: '剧情记忆', surface: 'memory.panel', instanceScope: 'timeline', adapter: 'shadow' }, {
    mount(root) {
      const target = ctx.timeline?.target
      if (!target) throw new Error('剧情记忆需要当前 Timeline。')
      const reactRoot = createRoot(root)
      const call = (method: string, args: Record<string, unknown> = {}) => ctx.rpc.call(`official.story-memory.${method}`, { timelineId: target.timelineId, branchId: target.branchId, ...args } as never)
      reactRoot.render(<><style>{panelCss}</style><StoryMemoryPanel timelineId={target.timelineId} call={call} /></>)
      return { dispose() { reactRoot.unmount() } }
    },
  })
}
