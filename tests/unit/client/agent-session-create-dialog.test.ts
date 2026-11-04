// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentSessionCreateDialog } from '../../../apps/studio-client/src/features/sessions/ui/agent-session-create-dialog.js'
import type { AgentPreset, AgentSession } from '../../../apps/studio-client/src/entities/index.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  document.body.replaceChildren()
})

async function fixture() {
  const session: AgentSession = { id: 'session', kind: 'agent', entryCount: 0, createdAt: '', updatedAt: '' }
  const onCreate = vi.fn<Parameters<typeof AgentSessionCreateDialog>[0]['onCreate']>(async () => session)
  const preset = (id: string, label: string): AgentPreset => ({ id, version: 1, resourceKind: 'preset',
    rootNode: { id: `${id}-root`, kind: 'module', label }, createdAt: '', updatedAt: '' })
  const props = {
    t: createTranslator('zh-CN'), presets: [preset('preset-a', 'Writing'),
      { ...preset('preset-b', 'Summary'), origin: { kind: 'extension-package' as const, packageId: 'memory', packageVersion: '1.0.0', contributionId: 'summary-preset' } }],
    initialPresetId: 'preset-a', onCreate, onCreated: vi.fn(), onClose: vi.fn(),
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => root.render(createElement(AgentSessionCreateDialog, props)))
  const click = async (label: string) => {
    await act(async () => document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click())
  }
  return { props, session, click, create: () => click('创建对话') }
}

describe('Agent session creation dialog', () => {
  it('creates the chosen preset Session without implicitly making it primary', async () => {
    const f = await fixture()
    await f.click('选择预设：Summary')
    await f.create()
    expect(f.props.onCreate).toHaveBeenCalledExactlyOnceWith('preset-b')
    expect(f.props.onCreated).toHaveBeenCalledWith(f.session)
    expect(f.props.onClose).toHaveBeenCalledOnce()
  })

  it('keeps the chosen preset after failure and opens only the successful retry', async () => {
    const f = await fixture()
    await f.click('选择预设：Summary')
    f.props.onCreate.mockRejectedValueOnce(new Error('Preset is unavailable'))
    await f.create()
    expect(f.props.onClose).not.toHaveBeenCalled()
    expect(f.props.onCreated).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')!.textContent).toBe('Preset is unavailable')
    await f.create()
    expect(f.props.onCreate.mock.calls).toEqual([['preset-b'], ['preset-b']])
    expect(f.props.onCreated).toHaveBeenCalledExactlyOnceWith(f.session)
    expect(f.props.onClose).toHaveBeenCalledOnce()
  })

  it('filters by source without losing the selected preset or creating a session', async () => {
    const f = await fixture()
    const search = document.querySelector<HTMLInputElement>('[aria-label="搜索 Agent 预设"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'memory')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect([...document.querySelectorAll('[aria-label^="选择预设："]')].map(element => element.getAttribute('aria-label'))).toEqual(['选择预设：Summary'])
    expect(document.querySelector<HTMLButtonElement>('[aria-label="创建对话"]')!.disabled).toBe(false)
    expect(f.props.onCreate).not.toHaveBeenCalled()
  })
})
