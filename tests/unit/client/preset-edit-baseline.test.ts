// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PresetTextUses, PresetWorkbench } from '../../../apps/studio-client/src/widgets/preset-workbench/preset-workbench.js'
import { useStudioLayoutStore } from '../../../apps/studio-client/src/shared/studio-shell/studio-layout-store.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import type { PromptResource, AgentToolDefinition } from '../../../apps/studio-client/src/entities/index.js'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
const t = createTranslator('zh-CN')
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  useStudioLayoutStore.getState().setViewPreference('preset.configuration', 'lore')
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals() })
const initial: PromptResource = { id: 'p', version: 1, resourceKind: 'preset', createdAt: '', updatedAt: '', rootNode: { id: 'r', kind: 'module', label: 'P' } }
const api: ComponentProps<typeof PresetTextUses>['api'] = {
  listRuleSummaries: async () => ({ rules: [] }),
  listExtractorSummaries: async () => ({ extractors: [] }),
  previewCardOpening: async () => { throw new Error('Unexpected previewCardOpening in preset configuration test') },
  listRules: async () => { throw new Error('Unexpected listRules in preset configuration test') },
  getRule: async () => { throw new Error('Unexpected getRule in preset configuration test') },
  upsertRule: async () => { throw new Error('Unexpected upsertRule in preset configuration test') },
  deleteRule: async () => { throw new Error('Unexpected deleteRule in preset configuration test') },
  listExtractors: async () => { throw new Error('Unexpected listExtractors in preset configuration test') },
  getExtractor: async () => { throw new Error('Unexpected getExtractor in preset configuration test') },
  upsertExtractor: async () => { throw new Error('Unexpected upsertExtractor in preset configuration test') },
  deleteExtractor: async () => { throw new Error('Unexpected deleteExtractor in preset configuration test') },
  getOverride: async () => { throw new Error('Unexpected getOverride in preset configuration test') },
  upsertOverride: async () => { throw new Error('Unexpected upsertOverride in preset configuration test') },
  deleteOverride: async () => { throw new Error('Unexpected deleteOverride in preset configuration test') },
  project: async () => { throw new Error('Unexpected project in preset configuration test') },
  inspectTextPipeline: async () => { throw new Error('Unexpected inspectTextPipeline in preset configuration test') },
  extract: async () => { throw new Error('Unexpected extract in preset configuration test') },
  listRenderers: async () => { throw new Error('Unexpected listRenderers in preset configuration test') },
}
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === label || item.textContent === label)!
  expect(button).toBeDefined()
  await act(async () => button.click())
}
it('uses refreshed clean configuration and requires explicit reapplication of failed edits', async () => {
  let preset = initial
  const save = vi.fn(async (input: Record<string, unknown>) => ({ ...preset, ...input, version: preset.version + 1 } as PromptResource))
  const render = async () => { await act(async () => root.render(createElement(PresetTextUses, { preset, api, t, onSave: save }))) }
  await render()
  preset = { ...preset, version: 2, useGlobalText: false }
  await render()
  save.mockRejectedValueOnce(new Error('Conflict'))
  await click('使用角色世界书')
  expect(save.mock.calls[0][0]).toMatchObject({ expectedVersion: 2, useGlobalText: false, useCardLore: false })
  preset = { ...preset, version: 3, useGlobalLore: false }
  await render()
  expect(container.textContent).toContain('采用服务端内容')
  expect(save).toHaveBeenCalledTimes(1)
  await click('重新应用保留的修改')
  expect(save.mock.calls[1][0]).toMatchObject({ expectedVersion: 3, useCardLore: false, useGlobalLore: false, useGlobalText: false })
})
it('can discard a failed configuration in favor of the refreshed server version', async () => {
  let preset = initial
  const save = vi.fn().mockRejectedValue(new Error('Conflict'))
  const render = async () => { await act(async () => root.render(createElement(PresetTextUses, { preset, api, t, onSave: save }))) }
  await render(); await click('使用角色世界书')
  preset = { ...preset, version: 2, useGlobalLore: false }
  await render(); await click('采用服务端内容')
  expect(container.querySelector('[aria-label="使用角色世界书"]')?.getAttribute('aria-pressed')).toBe('true')
  expect(container.querySelector('[aria-label="使用全局世界书"]')?.getAttribute('aria-pressed')).toBe('false')
  expect(save).toHaveBeenCalledTimes(1)
})
it('preserves input typed after saving a tool while accepting its committed version', async () => {
  let tool = { id: 'tool', version: 1, name: 'Original', description: '', owner: { namespace: 'test' }, input: { kind: 'structured', schema: {} } } as AgentToolDefinition
  const commit = Promise.withResolvers<void>()
  const onUpdateTool = vi.fn((_tool: AgentToolDefinition) => commit.promise)
  const props = { active: true, resources: [], loreMounts: [], toolMounts: [], draftResourceIds: [], routeToolId: 'tool', t, onUpdateTool } as unknown as ComponentProps<typeof PresetWorkbench>
  const render = async () => { await act(async () => root.render(createElement(PresetWorkbench, { ...props, tools: [tool] }))) }
  await render()
  const form = container.querySelector('form')!
  const name = form.querySelector('input')!
  const input = async (value: string) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, value); name.dispatchEvent(new Event('input', { bubbles: true })) }) }
  await input('Saved')
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(onUpdateTool.mock.calls[0][0]).toMatchObject({ name: 'Saved', version: 1 })
  await input('Continued')
  tool = { ...tool, name: 'Saved', version: 2 }
  await render(); await act(async () => commit.resolve())
  expect(name.value).toBe('Continued')
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(onUpdateTool.mock.calls[1][0]).toMatchObject({ name: 'Continued', version: 2 })
})
