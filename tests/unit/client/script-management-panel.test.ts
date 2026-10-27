// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScriptManagementPanel } from '../../../apps/studio-client/src/features/loom-scripts/ui/script-management-panel.js'
import { createScriptManagementPreviewApi } from '../../../apps/studio-client/src/dev-preview/script-management-fixtures.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

const roots: ReturnType<typeof createRoot>[] = []
beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function render(api = createScriptManagementPreviewApi()) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  const changed = vi.fn()
  await act(async () => root.render(createElement(ScriptManagementPanel, { api, cardId: 'preview-card', onScriptsChanged: changed, t: createTranslator('zh-CN') })))
  return { host, api, changed }
}
async function click(element: Element | null) { expect(element).not.toBeNull(); await act(async () => (element as HTMLElement).click()) }

describe('script management scope controls', () => {
  it('groups concrete owners and filters unrelated sources when selecting the current card', async () => {
    const api = createScriptManagementPreviewApi()
    const other = await api.import({ owner: { kind: 'card', cardId: 'other-card' }, fileName: 'other.loom.js', source: '// @name 其他角色规则' })
    const { host } = await render(api)
    expect(host.textContent).toContain('角色：preview-card')
    expect(host.textContent).toContain('角色：other-card')
    expect(host.querySelector(`[data-file-tree-node-id="${other.script.id}"]`)).not.toBeNull()
    const select = host.querySelector<HTMLSelectElement>('[aria-label="脚本查看与创建范围"]')!
    await act(async () => { select.value = 'card'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(host.querySelector(`[data-file-tree-node-id="${other.script.id}"]`)).toBeNull()
    expect(host.querySelector('[data-file-tree-node-id="status"]')).toBeNull()
    expect(host.querySelector('[data-file-tree-node-id="scene-card"]')).not.toBeNull()
    await act(async () => { select.value = 'user'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(host.querySelector(`[data-file-tree-node-id="${other.script.id}"]`)).not.toBeNull()
  })

  it('shows the enabled role mount even when creation targets global, and stops only that mount', async () => {
    const { host, api, changed } = await render()
    await click(host.querySelector('[data-file-tree-node-id="scene-card"]'))
    expect(host.querySelector<HTMLSelectElement>('select')?.value).toBe('user')
    const roleSwitch = host.querySelector('[role="switch"][aria-label="当前角色启用脚本"]')!
    expect(roleSwitch.getAttribute('aria-checked')).toBe('true')
    expect(host.querySelector('[aria-label="全局启用脚本"]')?.getAttribute('aria-checked')).toBe('false')
    expect(host.querySelector('textarea')).toBeNull()
    await click(roleSwitch)
    expect((await api.listMounts()).mounts.find(mount => mount.id === 'role')?.enabled).toBe(false)
    expect(changed).toHaveBeenCalledOnce()
    expect(host.querySelector('[aria-label="停用 场景背景卡 的所有范围"]')).toBeNull()
  })

  it('stops all scopes from the list and reports partial failure without hiding the remaining enabled mount', async () => {
    const api = createScriptManagementPreviewApi()
    await api.updateMount({ mountId: 'global', expectedVersion: 1, enabled: true, orderIndex: 0, grantedCapabilities: ['runtime.client'] })
    const update = api.updateMount
    vi.spyOn(api, 'updateMount').mockImplementation(input => input.mountId === 'role' ? Promise.reject(new Error('模拟角色版本冲突')) : update(input))
    const { host, changed } = await render(api)
    await click(host.querySelector('[aria-label="停用 场景背景卡 的所有范围"]'))
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('1 个范围未能停用')
    const { mounts } = await api.listMounts()
    expect(mounts.find(mount => mount.id === 'global')?.enabled).toBe(false)
    expect(mounts.find(mount => mount.id === 'role')?.enabled).toBe(true)
    expect(changed).toHaveBeenCalledOnce()
    expect(host.querySelector('[aria-label="停用 场景背景卡 的所有范围"]')).not.toBeNull()
  })

  it('keeps a new unsaved draft when closing is cancelled; closing details does not stop scripts', async () => {
    const { host, api, changed } = await render()
    await click([...host.querySelectorAll('button')].find(button => button.textContent === '新建')!)
    expect(host.querySelector('[data-loom-component="long-text-editor"]')).not.toBeNull()
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    await click(host.querySelector('[aria-label="关闭脚本详情"]'))
    expect(confirm).toHaveBeenCalledOnce()
    expect(host.querySelector('[data-loom-component="long-text-editor"]')).not.toBeNull()
    confirm.mockReturnValue(true)
    await click(host.querySelector('[aria-label="关闭脚本详情"]'))
    expect(host.querySelector('[data-loom-component="long-text-editor"]')).toBeNull()
    expect((await api.listMounts()).mounts.find(mount => mount.id === 'role')?.enabled).toBe(true)
    expect(changed).not.toHaveBeenCalled()
  })

  it('saves declared configuration on its mount without editing source or refreshing the instance', async () => {
    const api = createScriptManagementPreviewApi()
    const list = api.list
    vi.spyOn(api, 'list').mockImplementation(async () => ({ scripts: (await list()).scripts.map(script => ({ ...script,
      settings: [{ key: 'visible', label: '自动显示', type: 'boolean' as const, default: false }],
    })) }))
    const updateMount = vi.spyOn(api, 'updateMount')
    const updateSource = vi.spyOn(api, 'update')
    const refreshMount = vi.spyOn(api, 'refreshMount')
    const { host, changed } = await render(api)
    await click(host.querySelector('[data-file-tree-node-id="scene-card"]'))
    const role = host.querySelector('[aria-label="当前角色脚本配置"]')!
    await click(role.querySelector('[role="switch"][aria-label="自动显示"]'))
    await click([...role.querySelectorAll('button')].find(button => button.textContent === '保存配置')!)
    expect(updateMount).toHaveBeenCalledWith(expect.objectContaining({ mountId: 'role', settings: { visible: true }, enabled: true }))
    expect(updateSource).not.toHaveBeenCalled()
    expect(refreshMount).not.toHaveBeenCalled()
    expect(changed).not.toHaveBeenCalled()
  })

  it('filters scripts by author tag without replacing the selected detail', async () => {
    const api = createScriptManagementPreviewApi()
    const list = api.list
    vi.spyOn(api, 'list').mockImplementation(async () => ({ scripts: (await list()).scripts.map(script => ({ ...script,
      tags: script.id === 'scene-card' ? ['ui'] : ['utility'],
    })) }))
    const { host } = await render(api)
    await click(host.querySelector('[data-file-tree-node-id="scene-card"]'))
    const selector = host.querySelector<HTMLSelectElement>('[aria-label="按脚本标签筛选"]')!
    await act(async () => { selector.value = 'utility'; selector.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(host.querySelector('[data-file-tree-node-id="scene-card"]')).toBeNull()
    expect(host.querySelector('[data-file-tree-node-id="status"]')).not.toBeNull()
    expect(host.querySelector('h3')?.textContent).toBe('场景背景卡')
  })
})
