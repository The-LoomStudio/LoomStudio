// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { ExtensionConfigEntry, ExtensionSettingContribution, ExtensionStorageScope } from '@loom-studio/extension-sdk'
import { ExtensionSettingsForm } from '../../../apps/studio-client/src/features/extension-renderers/ui/extension-settings-form.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

type Props = Parameters<typeof ExtensionSettingsForm>[0]
let root: ReturnType<typeof createRoot> | undefined
let host: HTMLDivElement
afterEach(async () => {
  await act(async () => root?.unmount())
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function entry(value = 'server', version = 1, scope: ExtensionStorageScope = { kind: 'global' }): ExtensionConfigEntry {
  return { id: `config-${version}`, packageId: 'package', scope, key: 'name', value, version, createdAt: '', updatedAt: '' }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
function apiFor(initial = entry()) {
  return {
    listConfigs: vi.fn(async (_input: Parameters<Props['api']['listConfigs']>[0]) => ({ configs: [initial] })),
    getConfig: vi.fn(async (_input: Parameters<Props['api']['getConfig']>[0]) => ({ config: entry('latest', 2, initial.scope) as ExtensionConfigEntry | null })),
    upsertConfig: vi.fn(async (input: Parameters<Props['api']['upsertConfig']>[0]) => ({ config: entry(String(input.value), (input.expectedVersion ?? 0) + 1, input.scope), mutation: {} as never })),
  }
}
async function setup(overrides: Partial<Props> = {}) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  let props: Props = { api: apiFor(), packageId: 'package', target: { kind: 'global' }, configRevision: 0,
    scopeContext: {}, settings: [{ id: 'name', label: 'Name', type: 'text', default: 'default' }], t: createTranslator('zh-CN'), ...overrides }
  const render = async (patch: Partial<Props> = {}) => {
    props = { ...props, ...patch }
    await act(async () => root!.render(createElement(ExtensionSettingsForm, props)))
  }
  await render()
  return { render }
}
function input() { return host.querySelector<HTMLInputElement>('input')! }
async function edit(value: string, commit = true) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value)
    input().dispatchEvent(new Event('input', { bubbles: true }))
  })
  if (commit) await act(async () => input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
}
async function button(label: string) {
  await act(async () => [...host.querySelectorAll('button')].find(item => item.textContent === label)!.click())
}
async function tick() { await act(async () => vi.advanceTimersByTimeAsync(500)) }

it('sends explicit global/Card A/Card B targets on list, get and save without retaining another installation draft', async () => {
  const api = apiFor(entry('global', 1, { kind: 'card', cardId: 'A' }))
  const setting: ExtensionSettingContribution = { id: 'name', label: 'Name', type: 'text', scope: 'card', default: '' }
  const { render } = await setup({ api, settings: [setting], scopeContext: { cardId: 'A' } })
  await edit('global draft', false)
  api.listConfigs.mockResolvedValue({ configs: [entry('A', 1, { kind: 'card', cardId: 'A' })] })
  await render({ target: { kind: 'card', cardId: 'A' } })
  expect(input().value).toBe('A')
  api.upsertConfig.mockRejectedValueOnce(new Error('conflict'))
  await edit('A draft')
  expect(api.getConfig).toHaveBeenLastCalledWith({ packageId: 'package', target: { kind: 'card', cardId: 'A' }, scope: { kind: 'card', cardId: 'A' }, key: 'name' })
  api.listConfigs.mockResolvedValue({ configs: [entry('B', 1, { kind: 'card', cardId: 'B' })] })
  await render({ target: { kind: 'card', cardId: 'B' }, scopeContext: { cardId: 'B' } })
  expect(input().value).toBe('B')
  await edit('B saved')
  expect(api.listConfigs.mock.calls.map(args => args[0])).toEqual([
    { packageId: 'package', target: { kind: 'global' }, scope: { kind: 'card', cardId: 'A' } },
    { packageId: 'package', target: { kind: 'card', cardId: 'A' }, scope: { kind: 'card', cardId: 'A' } },
    { packageId: 'package', target: { kind: 'card', cardId: 'B' }, scope: { kind: 'card', cardId: 'B' } },
  ])
  expect(api.upsertConfig.mock.calls.map(args => args[0].target)).toEqual([{ kind: 'card', cardId: 'A' }, { kind: 'card', cardId: 'B' }])
  await tick()
  expect(api.upsertConfig).toHaveBeenCalledTimes(2)
})

it('freezes the dirty baseline across revision refresh and requires explicit reapply after each conflict', async () => {
  const api = apiFor()
  const { render } = await setup({ api })
  await edit('draft', false)
  api.listConfigs.mockResolvedValue({ configs: [entry('external', 2)] })
  await render({ configRevision: 1 })
  expect(input().value).toBe('draft')
  const failed = deferred<Awaited<ReturnType<Props['api']['upsertConfig']>>>()
  const reapplied = deferred<Awaited<ReturnType<Props['api']['upsertConfig']>>>()
  api.upsertConfig.mockReturnValueOnce(failed.promise).mockRejectedValueOnce(new Error('conflict two')).mockReturnValueOnce(reapplied.promise)
  await tick()
  expect(api.upsertConfig.mock.calls[0]![0].expectedVersion).toBe(1)
  await edit('queued before failure')
  await act(async () => failed.reject(new Error('conflict one')))
  expect(api.upsertConfig).toHaveBeenCalledTimes(1)
  await edit('edited during recovery')
  await act(async () => input().dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  await tick()
  expect(api.upsertConfig).toHaveBeenCalledTimes(1)
  api.getConfig.mockResolvedValueOnce({ config: entry('latest again', 3) })
  await button('重新应用此草稿')
  expect(api.upsertConfig.mock.calls[1]![0]).toMatchObject({ value: 'edited during recovery', expectedVersion: 2 })
  expect(input().value).toBe('edited during recovery')
  expect(host.textContent).toContain('conflict two')
  await button('重新应用此草稿')
  expect(api.upsertConfig.mock.calls[2]![0]).toMatchObject({ value: 'edited during recovery', expectedVersion: 3 })
  expect(host.textContent).not.toContain('重新应用此草稿')
  await edit('typed while reapplying', false)
  await tick()
  expect(api.upsertConfig).toHaveBeenCalledTimes(3)
  await act(async () => reapplied.resolve({ config: entry('edited during recovery', 4), mutation: {} as never }))
  expect(input().value).toBe('typed while reapplying')
  expect(api.upsertConfig.mock.calls[3]![0]).toMatchObject({ value: 'typed while reapplying', expectedVersion: 4 })
})

it('can adopt the latest server value without writing and resumes autosave from its version', async () => {
  const api = apiFor()
  api.upsertConfig.mockRejectedValueOnce(new Error('conflict'))
  await setup({ api })
  await edit('draft')
  await button('使用服务端值')
  expect(input().value).toBe('latest')
  expect(api.upsertConfig).toHaveBeenCalledTimes(1)
  await edit('after adoption')
  expect(api.upsertConfig.mock.calls[1]![0]).toMatchObject({ value: 'after adoption', expectedVersion: 2 })
})

it('retains drafts when latest cannot be read and supports explicit default recovery for a deleted entry', async () => {
  const api = apiFor()
  api.upsertConfig.mockRejectedValueOnce(new Error('write failed'))
  api.getConfig.mockRejectedValueOnce(new Error('read failed')).mockResolvedValueOnce({ config: null })
  await setup({ api })
  await edit('draft')
  expect(host.textContent).toContain('read failed')
  expect(host.textContent).not.toContain('重新应用此草稿')
  await edit('still draft')
  await tick()
  expect(api.upsertConfig).toHaveBeenCalledTimes(1)
  await button('重新读取最新值')
  await button('使用默认值')
  expect(input().value).toBe('default')
  await edit('new value')
  expect(api.upsertConfig.mock.calls[1]![0]).not.toHaveProperty('expectedVersion')
})

it('confirms only the submitted snapshot, drains a queued edit, and preserves an edit made while saving', async () => {
  const api = apiFor()
  const first = deferred<Awaited<ReturnType<Props['api']['upsertConfig']>>>()
  const second = deferred<Awaited<ReturnType<Props['api']['upsertConfig']>>>()
  api.upsertConfig.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  await setup({ api })
  await edit('first')
  await edit('queued')
  expect(api.upsertConfig).toHaveBeenCalledTimes(1)
  await act(async () => first.resolve({ config: entry('first', 2), mutation: {} as never }))
  expect(api.upsertConfig.mock.calls[1]![0]).toMatchObject({ value: 'queued', expectedVersion: 2 })
  await edit('new unsent', false)
  await act(async () => second.resolve({ config: entry('queued', 3), mutation: {} as never }))
  expect(input().value).toBe('new unsent')
  expect(host.textContent).toContain('等待自动保存')
  await tick()
  expect(api.upsertConfig.mock.calls[2]![0]).toMatchObject({ value: 'new unsent', expectedVersion: 3 })
})

it('isolates changed API sources and ignores late saves and pending timers after unmount', async () => {
  const oldApi = apiFor()
  const pending = deferred<Awaited<ReturnType<Props['api']['upsertConfig']>>>()
  oldApi.upsertConfig.mockReturnValueOnce(pending.promise)
  const { render } = await setup({ api: oldApi })
  await edit('old pending')
  await edit('old queued', false)
  const nextApi = apiFor(entry('new source', 8))
  await render({ api: nextApi })
  expect(input().value).toBe('new source')
  await act(async () => pending.resolve({ config: entry('old pending', 2), mutation: {} as never }))
  await tick()
  expect(input().value).toBe('new source')
  expect(oldApi.upsertConfig).toHaveBeenCalledTimes(1)
  expect(nextApi.upsertConfig).not.toHaveBeenCalled()
  await edit('unmounted draft', false)
  await act(async () => root!.unmount())
  root = undefined
  await tick()
  expect(nextApi.upsertConfig).not.toHaveBeenCalled()
})

it('gates illegal or unproven card scopes, unknown scope kinds and read-only fields', async () => {
  const api = apiFor()
  const scopes = ['global', 'card', 'timeline', 'agent-session', 'illegal']
  const settings = scopes.map((scope, index) => ({ id: `setting${index}`, label: scope, type: 'text', default: '', scope })) as ExtensionSettingContribution[]
  const { render } = await setup({ api, target: { kind: 'card', cardId: 'A' }, settings,
    scopeContext: { cardId: 'B', timelineId: 'timeline', agentSessionId: 'session' } })
  expect([...host.querySelectorAll('input')].every(control => control.disabled)).toBe(true)
  expect(api.listConfigs).not.toHaveBeenCalled()
  await render({ scopeContext: { cardId: 'A', timelineId: 'timeline', timelineCardId: 'A', agentSessionId: 'session', agentSessionCardId: 'A' } })
  expect(api.listConfigs).toHaveBeenCalledTimes(3)
  expect(api.listConfigs.mock.calls.map(args => args[0].scope)).toEqual(expect.arrayContaining([
    { kind: 'card', cardId: 'A' }, { kind: 'timeline', timelineId: 'timeline' }, { kind: 'agent-session', agentSessionId: 'session' },
  ]))
  expect(scopes.map((_, index) => host.querySelector<HTMLInputElement>(`#extension-setting-setting${index}`)!.disabled)).toEqual([true, false, false, false, true])
  await render({ target: { kind: 'global' }, settings: [{ id: 'name', label: 'Name', type: 'text', default: '', readOnly: true }] })
  expect(input().disabled).toBe(true)
  await edit('blocked')
  await tick()
  expect(api.upsertConfig).not.toHaveBeenCalled()
})

it('keeps global dirty fields when unrelated timeline context changes', async () => {
  const api = apiFor()
  const { render } = await setup({ api, scopeContext: { timelineId: 'one' } })
  await edit('kept draft', false)
  await render({ scopeContext: { timelineId: 'two' } })
  expect(input().value).toBe('kept draft')
  expect(api.listConfigs).toHaveBeenCalledTimes(1)
})


it.each(['target', 'api'] as const)('ignores a late recovery read after changing %s', async identity => {
  const initial = entry('A', 1, { kind: 'card', cardId: 'A' })
  const api = apiFor(initial)
  const latest = deferred<{ config: ExtensionConfigEntry | null }>()
  api.upsertConfig.mockRejectedValueOnce(new Error('conflict'))
  api.getConfig.mockReturnValueOnce(latest.promise)
  const { render } = await setup({ api, target: { kind: 'card', cardId: 'A' }, scopeContext: { cardId: 'A' },
    settings: [{ id: 'name', label: 'Name', type: 'text', scope: 'card', default: '' }] })
  await edit('old draft')
  await edit('edited during latest read', false)
  expect(input().value).toBe('edited during latest read')
  await tick()
  expect(api.upsertConfig).toHaveBeenCalledTimes(1)
  const replacement = apiFor(entry('new identity', 8, { kind: 'card', cardId: identity === 'target' ? 'B' : 'A' }))
  if (identity === 'target') {
    api.listConfigs.mockResolvedValue({ configs: [entry('new identity', 8, { kind: 'card', cardId: 'B' })] })
    await render({ target: { kind: 'card', cardId: 'B' }, scopeContext: { cardId: 'B' } })
  } else await render({ api: replacement })
  await act(async () => latest.resolve({ config: entry('late A', 2, initial.scope) }))
  expect(input().value).toBe('new identity')
  expect(host.textContent).not.toContain('重新应用此草稿')
  await edit('new saved')
  const writer = identity === 'target' ? api : replacement
  expect(writer.upsertConfig).toHaveBeenLastCalledWith(expect.objectContaining({
    value: 'new saved', expectedVersion: 8, target: { kind: 'card', cardId: identity === 'target' ? 'B' : 'A' },
  }))
})

it('ignores an installation save after switching target and does not drain its old queued value', async () => {
  const api = apiFor(entry('A', 1, { kind: 'card', cardId: 'A' }))
  const pending = deferred<Awaited<ReturnType<Props['api']['upsertConfig']>>>()
  api.upsertConfig.mockReturnValueOnce(pending.promise)
  const { render } = await setup({ api, target: { kind: 'card', cardId: 'A' }, scopeContext: { cardId: 'A' },
    settings: [{ id: 'name', label: 'Name', type: 'text', scope: 'card', default: '' }] })
  await edit('A pending')
  await edit('A queued')
  api.listConfigs.mockResolvedValue({ configs: [entry('B', 8, { kind: 'card', cardId: 'B' })] })
  await render({ target: { kind: 'card', cardId: 'B' }, scopeContext: { cardId: 'B' } })
  await act(async () => pending.resolve({ config: entry('A pending', 2, { kind: 'card', cardId: 'A' }), mutation: {} as never }))
  await tick()
  expect(input().value).toBe('B')
  expect(api.upsertConfig).toHaveBeenCalledTimes(1)
})
