// @vitest-environment happy-dom
import { useStudioLayoutStore } from '../../../apps/studio-client/src/shared/studio-shell/studio-layout-store.js'
import { parseLoomScriptSource } from '@loom-studio/shared/loom-scripts'
import { createTextRuleScriptTemplate } from '../../../apps/studio-client/src/features/loom-scripts/model/script-template.js'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScriptManagementPanel } from '../../../apps/studio-client/src/features/loom-scripts/ui/script-management-panel.js'
import { createScriptManagementPreviewApi } from '../../../apps/studio-client/src/dev-preview/script-management-fixtures.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

const roots: ReturnType<typeof createRoot>[] = []
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); useStudioLayoutStore.setState({ viewPreferences: {} }) })
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function render(api = createScriptManagementPreviewApi(), initialFilter: 'rules' | 'runtime' | null = 'runtime', cardId = 'preview-card') {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  const changed = vi.fn()
  await act(async () => root.render(createElement(ScriptManagementPanel, { api, initialFilter: initialFilter ?? undefined, cardId, onScriptsChanged: changed, t: createTranslator('zh-CN') })))
  return { host, api, changed, root }
}
async function click(element: Element | null) { expect(element).not.toBeNull(); await act(async () => (element as HTMLElement).click()) }

describe('script management scope controls', () => {
  it('restores the nested scope after remount without forgetting it when no card is available', async () => {
    const first = await render()
    await click([...first.host.querySelectorAll('[aria-label="脚本查看范围"] [role="tab"]')].find(node => node.textContent === '当前角色')!)
    await act(async () => first.root.render(null))
    const absent = await render(first.api, 'runtime', '')
    expect(absent.host.querySelector('[aria-label="脚本查看范围"] [aria-selected="true"]')?.textContent).toBe('全局')
    expect(useStudioLayoutStore.getState().viewPreferences['scripts.scope']).toBe('card')
    await act(async () => absent.root.render(null))
    const reopened = await render(first.api)
    expect(reopened.host.querySelector('[aria-label="脚本查看范围"] [aria-selected="true"]')?.textContent).toBe('当前角色')
    expect(reopened.host.querySelector('[aria-label="脚本分类"] [aria-selected="true"]')?.textContent).toBe('脚本')
  })

  it('keeps the saved classification on ordinary entry but honors an explicit filter', async () => {
    useStudioLayoutStore.getState().setViewPreference('scripts.filter', 'runtime')
    const ordinary = await render(createScriptManagementPreviewApi(), null)
    expect(ordinary.host.querySelector('[aria-label="脚本分类"] [aria-selected="true"]')?.textContent).toBe('脚本')
    await act(async () => ordinary.root.render(null))
    const explicit = await render(ordinary.api, 'rules')
    expect(explicit.host.querySelector('[aria-label="脚本分类"] [aria-selected="true"]')?.textContent).toBe('正则')
  })

  it('keeps registry controls and drag spacing stable while reading a selection', async () => {
    const api = createScriptManagementPreviewApi()
    const originalExport = api.export
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(api, 'export').mockImplementation(async id => { await pending; return originalExport(id) })
    const { host } = await render(api)
    const row = host.querySelector('[data-file-tree-node-id="scene-card"]')!
    const before = row.className
    await click(row)
    expect(host.querySelector('[data-file-tree-node-id="scene-card"]')?.className).toBe(before)
    expect((host.querySelector('[aria-label="停用 场景背景卡 的所有范围"]') as HTMLButtonElement).disabled).toBe(false)
    await act(async () => { release(); await pending })
    expect(host.querySelector('h3')?.textContent).toBe('场景背景卡')
  })

  it('groups concrete owners and filters unrelated sources when selecting the current card', async () => {
    const api = createScriptManagementPreviewApi()
    const other = await api.import({ owner: { kind: 'card', cardId: 'other-card' }, fileName: 'other.loom.js', source: '// @name 其他角色规则' })
    const { host } = await render(api)
    expect(host.textContent).toContain('preview-card')
    expect(host.textContent).toContain('other-card')
    expect(host.querySelector(`[data-file-tree-node-id="${other.script.id}"]`)).not.toBeNull()
    await click([...host.querySelectorAll('[aria-label="脚本查看范围"] [role="tab"]')].find(node => node.textContent === '当前角色')!)
    expect(host.querySelector(`[data-file-tree-node-id="${other.script.id}"]`)).toBeNull()
    expect(host.querySelector('[data-file-tree-node-id="status"]')).toBeNull()
    expect(host.querySelector('[data-file-tree-node-id="scene-card"]')).not.toBeNull()
    await click([...host.querySelectorAll('[aria-label="脚本查看范围"] [role="tab"]')].find(node => node.textContent === '全局')!)
    expect(host.querySelector(`[data-file-tree-node-id="${other.script.id}"]`)).not.toBeNull()
  })

  it('shows the enabled role mount even when creation targets global, and stops only that mount', async () => {
    const { host, api, changed } = await render()
    await click(host.querySelector('[data-file-tree-node-id="scene-card"]'))
    expect(host.querySelector('[aria-label="脚本查看范围"] [aria-selected="true"]')?.textContent).toBe('全局')
    const roleSwitch = host.querySelector('[aria-label="当前角色启用脚本"]')!
    expect(roleSwitch.getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('[aria-label="全局启用脚本"]')?.getAttribute('aria-pressed')).toBe('false')
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
    await click(host.querySelector('button[aria-label="新建脚本"]')!)
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


describe('script classification and ordering', () => {
  async function fixture() {
    const api = createScriptManagementPreviewApi('many')
    const originalList = api.list
    const rules = parseLoomScriptSource(createTextRuleScriptTemplate()).contributions
    vi.spyOn(api, 'list').mockImplementation(async () => ({ scripts: (await originalList()).scripts.map(script => {
      if (!['helper-0', 'helper-2', 'helper-3'].includes(script.id)) return script
      return { ...script, runtime: script.id === 'helper-3' ? 'client' as const : 'declarative' as const, contributions: rules }
    }) }))
    return { ...api, reorder: vi.fn(async () => ({ mutation: { changesetId: 'reordered' } })) }
  }
  it('shows mixed scripts in both categories and only flattens the filtered category', async () => {
    const api = await fixture()
    const { host } = await render(api)
    expect([...host.querySelectorAll('[aria-label="脚本分类"] [role="tab"]')].map(node => node.textContent)).toEqual(['正则', '脚本'])
    expect(host.querySelector('[data-file-tree-node-id="helper-3"]')).not.toBeNull()
    const select = (label: string) => click([...host.querySelectorAll('[role="tab"]')].find(node => node.textContent === label)!)
    await select('正则')
    expect(host.querySelector('[data-file-tree-node-id="helper-0"]')).not.toBeNull()
    expect(host.querySelector('[data-file-tree-node-id="helper-1"]')).toBeNull()
    expect(host.querySelector('[data-file-tree-node-id="helper-3"]')).not.toBeNull()
    expect(host.querySelector('[data-file-tree-node-id^="rules:owner:"]')).toBeNull()
    await select('脚本')
    expect(host.querySelector('[data-file-tree-node-id="helper-0"]')).toBeNull()
    expect(host.querySelector('[data-file-tree-node-id="helper-1"]')).not.toBeNull()
    expect(host.querySelector('[data-file-tree-node-id="helper-3"]')).not.toBeNull()
  })
  it('persists owner group order with every member even when the category hides scripts', async () => {
    const api = await fixture()
    const { host } = await render(api, 'runtime')
    const source = 'owner:' + JSON.stringify({ kind: 'user' })
    const target = [...host.querySelectorAll('[data-file-tree-node-id]')].find(node => node.getAttribute('data-file-tree-node-id') === 'owner:' + JSON.stringify({ kind: 'card', cardId: 'preview-card' }))!
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: { getData: () => source } })
    await act(async () => { target.dispatchEvent(drop) })
    expect(api.reorder).toHaveBeenCalledWith({ groups: [
      { owner: { kind: 'user' }, groupOrder: 0, scriptIds: expect.arrayContaining(['helper-0', 'helper-1', 'helper-2', 'helper-3']) },
      { owner: { kind: 'card', cardId: 'preview-card' }, groupOrder: 1, scriptIds: ['scene-card'] },
      { owner: { kind: 'extension', packageId: 'example.status', installationId: 'preview' }, groupOrder: 2, scriptIds: ['status'] },
    ] })
  })
  it('merges filtered reordering into the complete owner order without moving hidden entries', async () => {
    const api = await fixture()
    const { host } = await render(api, 'rules')
    const all = (await api.list()).scripts.filter(script => script.owner.kind === 'user').sort((a, b) => a.id.localeCompare(b.id)).map(script => script.id)
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: { getData: () => 'helper-2' } })
    await act(async () => { host.querySelector('[data-file-tree-node-id="helper-0"]')!.dispatchEvent(drop) })
    const expected = [...all]
    expected[all.indexOf('helper-0')] = 'helper-2'
    expected[all.indexOf('helper-2')] = 'helper-0'
    expect(api.reorder).toHaveBeenCalledWith({ groups: [{ owner: { kind: 'user' }, scriptIds: expected }] })
  })
})
