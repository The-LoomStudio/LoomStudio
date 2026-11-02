// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useNewStoryExtensions } from '../../../apps/studio-client/src/features/extension-renderers/ui/new-story-extensions.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import { useExtensionCardContext } from '../../../apps/studio-client/src/features/extension-renderers/model/use-extension-card-context.js'
import type { Card } from '../../../apps/studio-client/src/entities/index.js'
import { t } from '../../../apps/studio-client/src/shared/i18n/index.js'

type ProfileConfig = Awaited<ReturnType<StudioApi['userProfiles']['get']>>['config']
const initialProfiles: ProfileConfig = { version: 3, currentProfileId: 'one', profiles: [
  { id: 'one', name: 'First', description: 'First description', avatarAssetId: 'avatar-one' },
  { id: 'two', name: 'Second', description: 'Second description', avatarAssetId: 'avatar-two' },
] }

function fixture(config: ProfileConfig = structuredClone(initialProfiles), getProfiles?: StudioApi['userProfiles']['get']) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const packages = [
    { packageId: 'example.world', displayName: '世界', participation: 'timeline', available: true, modules: [{ desired: { enabled: true } }] },
    { packageId: 'example.disabled', displayName: '未启用', participation: 'timeline', available: true, modules: [{ desired: { enabled: false } }] },
    { packageId: 'example.theme', displayName: '主题', available: true, modules: [{ desired: { enabled: true } }] },
  ]
  const writes = { updateCard: vi.fn(), createStory: vi.fn(), updateProfile: vi.fn(), selectProfile: vi.fn() }
  const api = {
    cards: { get: async () => ({ card: { id: 'card', name: '当前角色' } }), update: writes.updateCard },
    narratives: { create: writes.createStory },
    userProfiles: { get: getProfiles ?? (async () => ({ config })), update: writes.updateProfile, select: writes.selectProfile },
    extensions: { list: async (target?: unknown) => ({ items: target ? [] : packages }) },
    extensionInstallations: { list: async () => ({ installations: packages.map(pkg => ({
      id: `extension-installation:["global","${pkg.packageId}"]`, packageId: pkg.packageId,
      participation: pkg.participation, target: { kind: 'global' },
    })) }) },
  } as unknown as StudioApi
  let current!: ReturnType<typeof useNewStoryExtensions>
  function Fixture() { current = useNewStoryExtensions(api, t); return current.dialog }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  return {
    container, config, writes,
    mount: async () => { await act(async () => { root.render(createElement(Fixture)) }) },
    choose: () => current.choose('card'),
    button: (label: string) => [...container.querySelectorAll('button')].find(button => button.textContent === label)!,
    select: (id: string) => act(() => {
      const select = container.querySelector('select')!
      select.value = id
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }),
    edit: (selector: string, value: string) => act(() => {
      const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!
      const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }),
    unmount: () => { act(() => root.unmount()); container.remove() },
  }
}

it('copies the current template and returns the adjusted extension selection without writes', async () => {
  const view = fixture()
  try {
    await view.mount()
    let pending!: ReturnType<typeof view.choose>
    await act(async () => { pending = view.choose() })
    expect(view.container.querySelector('select')?.value).toBe('one')
    expect(view.container.querySelector('input[type=text]')?.getAttribute('value')).toBe('First')
    expect(view.container.querySelector('textarea')?.value).toBe('First description')
    const checkboxes = [...view.container.querySelectorAll<HTMLInputElement>('input[type=checkbox]')]
    expect(checkboxes).toHaveLength(2)
    expect(checkboxes[0]!.checked).toBe(true)
    expect(checkboxes[1]!.checked).toBe(false)
    expect(checkboxes[1]!.disabled).toBe(true)
    act(() => { checkboxes[0]!.click() })
    act(() => { view.button('开始叙事').click() })
    expect(await pending).toEqual({ extensionAdoptions: [], playerProfile: {
      name: 'First', description: 'First description', avatarAssetId: 'avatar-one',
    } })
    for (const write of Object.values(view.writes)) expect(write).not.toHaveBeenCalled()
  } finally { view.unmount() }
})

it('switches templates, returns this story’s edited draft and leaves global templates unchanged', async () => {
  const view = fixture()
  try {
    await view.mount()
    let pending!: ReturnType<typeof view.choose>
    await act(async () => { pending = view.choose() })
    view.select('two')
    expect(view.container.querySelector<HTMLInputElement>('input[type=text]')?.value).toBe('Second')
    expect(view.container.querySelector('textarea')?.value).toBe('Second description')
    view.edit('input[type=text]', 'Story name')
    view.edit('textarea', 'Story description\nSecond line')
    act(() => { view.button('开始叙事').click() })
    expect(await pending).toEqual({ extensionAdoptions: [{ packageId: 'example.world', target: 'global' }], playerProfile: {
      name: 'Story name', description: 'Story description\nSecond line', avatarAssetId: 'avatar-two',
    } })
    expect(view.config).toEqual(initialProfiles)
    for (const write of Object.values(view.writes)) expect(write).not.toHaveBeenCalled()
  } finally { view.unmount() }
})

it('clears the copied avatar and text when switching to a blank identity, and starts without templates', async () => {
  const view = fixture()
  const empty = fixture({ version: 0, profiles: [], currentProfileId: null })
  try {
    await view.mount()
    let pending!: ReturnType<typeof view.choose>
    await act(async () => { pending = view.choose() })
    view.select('')
    act(() => { view.button('开始叙事').click() })
    expect((await pending)?.playerProfile).toEqual({ name: 'User', description: '' })
    await empty.mount()
    await act(async () => { pending = empty.choose() })
    expect(empty.container.querySelectorAll('option')).toHaveLength(1)
    expect(empty.button('开始叙事').disabled).toBe(false)
    act(() => { empty.button('开始叙事').click() })
    expect((await pending)?.playerProfile).toEqual({ name: 'User', description: '' })
  } finally { view.unmount(); empty.unmount() }
})

it('cancels an edited draft without writing business resources', async () => {
  const view = fixture()
  try {
    await view.mount()
    let pending!: ReturnType<typeof view.choose>
    await act(async () => { pending = view.choose() })
    view.select('two')
    view.edit('input[type=text]', 'Discarded draft')
    act(() => { view.button('取消').click() })
    expect(await pending).toBeUndefined()
    expect(view.config).toEqual(initialProfiles)
    for (const write of Object.values(view.writes)) expect(write).not.toHaveBeenCalled()
  } finally { view.unmount() }
})

it('blocks confirmation while templates are loading and after a read failure', async () => {
  let reject!: (reason: Error) => void
  const view = fixture(undefined, () => new Promise((_, fail) => { reject = fail }))
  try {
    await view.mount()
    let pending!: ReturnType<typeof view.choose>
    await act(async () => { pending = view.choose() })
    expect(view.button('开始叙事').disabled).toBe(true)
    expect(view.container.querySelector('[role=status]')?.textContent).toContain('用户模板')
    await act(async () => { reject(new Error('Profile request failed')) })
    expect(view.button('开始叙事').disabled).toBe(true)
    expect(view.container.querySelector('[role=alert]')?.textContent).toBe('Profile request failed')
    act(() => { view.button('取消').click() })
    expect(await pending).toBeUndefined()
  } finally { view.unmount() }
})

it('uses the story Card and discards a late response from the previous Card', async () => {
  const responses = new Map<string, (value: { card: Card }) => void>()
  const api = { cards: { get: (id: string) => new Promise<{ card: Card }>(resolve => { responses.set(id, resolve) }) } } as unknown as StudioApi
  const card = (id: string) => ({ id, name: id, version: 1 }) as Card
  let current!: ReturnType<typeof useExtensionCardContext>
  function Fixture({ id }: { id: string }) { current = useExtensionCardContext(api, id, card('editor')); return null }
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(Fixture, { id: 'previous' })) })
    expect(current.card).toBeUndefined()
    await act(async () => { root.render(createElement(Fixture, { id: 'current' })) })
    await act(async () => { responses.get('previous')!({ card: card('previous') }) })
    expect(current.card).toBeUndefined()
    await act(async () => { responses.get('current')!({ card: card('current') }) })
    expect(current.card?.id).toBe('current')
  } finally { act(() => root.unmount()) }
})
