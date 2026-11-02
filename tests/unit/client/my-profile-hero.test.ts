// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { MyProfile, type MyProfileProps } from '../../../apps/studio-client/src/widgets/my-profile/my-profile.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

it('displays the profile in the Hero and autosaves edits without a permanent save toolbar', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const commit = vi.fn()
  const props: MyProfileProps = {
    profiles: [{ id: 'me', name: 'Writer', description: 'A quiet traveller.' }], currentProfileId: 'me', resources: null,
    t: createTranslator('zh-CN'), onChange: vi.fn(), onCommit: commit, onSelect: vi.fn(), onCreate: vi.fn(), onAvatarChange: vi.fn(), onAvatarClear: vi.fn(),
  }
  try {
    await act(async () => root.render(createElement(MyProfile, props)))
    expect(host.querySelector('header')?.textContent).toContain('A quiet traveller.')
    expect([...host.querySelectorAll('button')].filter(button => !button.closest('dialog, [role=dialog]')).some(button => button.textContent === '保存')).toBe(false)
    expect([...host.querySelectorAll('button')].filter(button => !button.closest('dialog, [role=dialog]')).some(button => button.textContent === '刷新资料')).toBe(false)
    await act(async () => (host.querySelector('button[aria-label="编辑设定"]') as HTMLButtonElement).click())
    expect(document.querySelector('textarea')?.value).toBe('A quiet traveller.')
    await act(async () => root.render(createElement(MyProfile, { ...props, dirty: true, profiles: [{ ...props.profiles[0]!, description: 'Updated profile' }] })))
    await act(async () => vi.advanceTimersByTime(600))
    expect(commit).toHaveBeenCalledOnce()
    commit.mockClear()
    await act(async () => root.render(createElement(MyProfile, { ...props, dirty: true, error: 'Conflict', profiles: [{ ...props.profiles[0]!, description: 'Preserved draft' }] })))
    await act(async () => vi.advanceTimersByTime(1200))
    expect(commit).not.toHaveBeenCalled()
    expect(document.querySelector('textarea')?.value).toBe('Preserved draft')
    expect(document.body.textContent).toContain('重试保存')
  } finally {
    await act(async () => root.unmount())
    host.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})
