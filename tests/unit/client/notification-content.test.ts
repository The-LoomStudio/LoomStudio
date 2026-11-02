// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { NotificationToaster } from '../../../apps/studio-client/src/shared/ui/notification-toaster/notification-toaster.js'
import { notify } from '../../../apps/studio-client/src/shared/notifications/notification-service.js'
import { useNotificationDetails } from '../../../apps/studio-client/src/shared/notifications/notification-details-store.js'
import { describeDisplayDiagnostics } from '../../../apps/studio-client/src/features/message-content/ui/display-projection-status.js'
afterEach(() => { vi.clearAllMocks(); useNotificationDetails.getState().close() })
describe('actionable notification content', () => {
  it('keeps raw error IDs in an independent inspector and preserves the repair action', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const open = vi.fn()
    try {
      await act(async () => root.render(createElement(NotificationToaster, { label: '通知' })))
      let id!: string | number
      await act(async () => { id = notify.failure('保存角色资料失败', new Error('Card missing: opaque-card-id'), { action: { label: '打开角色', onClick: open } }); await new Promise(resolve => setTimeout(resolve, 20)) })
      expect(host.textContent).toContain('保存角色资料失败')
      expect(host.textContent).not.toContain('opaque-card-id')
      expect([...host.querySelectorAll('button')].some(button => button.textContent === '打开角色')).toBe(true)
      await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === '详情')!.click())
      await act(async () => notify.dismiss(id))
      expect(useNotificationDetails.getState().detail?.text).toBe('Card missing: opaque-card-id')
    } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() }
  })
  it('identifies the referring preset and missing reference position without inventing a lost name', () => {
    const summary = describeDisplayDiagnostics([{ code: 'text.use_unresolved', message: 'Preset rule reference is unavailable: secret-id', ruleId: 'secret-id', presetId: 'preset-id', presetName: '写作助手', resourceKind: 'rule', referenceIndex: 2 }])
    expect(summary).toContain('写作助手')
    expect(summary).toContain('第 2 项引用')
    expect(summary).not.toContain('secret-id')
    expect(summary).not.toContain('preset-id')
    expect(summary).toContain('名称不可用')
  })
  it('uses available resource names and gives unknown diagnostics a readable summary', () => {
    expect(describeDisplayDiagnostics([{ code: 'text.use_unresolved', message: 'raw-id', resourceName: '隐藏思考', presetName: '助手', resourceKind: 'rule' }])).toContain('隐藏思考')
    expect(describeDisplayDiagnostics([{ code: 'unknown', message: 'module-id: rule-id' }])).not.toContain('rule-id')
  })
})
