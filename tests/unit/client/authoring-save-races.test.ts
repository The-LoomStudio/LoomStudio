// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMacroAuthoring, type MacroAuthoringController, type MacroAuthoringSource } from '../../../apps/studio-client/src/features/state-variables/ui/macro-authoring-panel.js'
import { ThemeSettings } from '../../../apps/studio-client/src/features/themes/ui/theme-settings.js'
import type { ThemeController } from '../../../apps/studio-client/src/features/themes/model/theme-controller.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

const t = createTranslator('en-US')
const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.replaceChildren() })
function mount() {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  return { host, root }
}

describe('authoring asynchronous responses', () => {
  it('keeps macros added during save dirty and uses the acknowledged version on the next save', async () => {
    const pending = Promise.withResolvers<{ version: number; macros: Record<string, string> }>()
    const onSave = vi.fn<MacroAuthoringSource['onSave']>().mockReturnValueOnce(pending.promise)
      .mockImplementation(async input => ({ version: 3, macros: input.macros }))
    const sources: MacroAuthoringSource[] = [{ id: 'p', kind: 'preset', label: 'Preset', version: 1, macros: { tone: 'plain' }, onSave }]
    let controller!: MacroAuthoringController
    function Harness() { controller = useMacroAuthoring(sources, t); return null }
    const { root } = mount()
    await act(async () => root.render(createElement(Harness)))
    await act(async () => controller.updateRow('p', controller.sourceRows.p![0]!.id, { value: 'warm' }))
    let saving!: Promise<void>
    await act(async () => { saving = controller.save('p') })
    await act(async () => controller.addRow('p'))
    await act(async () => { pending.resolve({ version: 2, macros: { tone: 'warm' } }); await saving })
    expect(controller.sourceRows.p).toHaveLength(2)
    expect(controller.dirtySources.p).toBe(true)
    await act(async () => controller.save('p'))
    expect(onSave.mock.calls[1]![0]).toMatchObject({ expectedVersion: 2, macros: { tone: 'warm', macro_2: '' } })
    expect(controller.dirtySources.p).toBe(false)
  })

  it('keeps an unauthorized theme candidate visible so CSS-only can be applied', async () => {
    const selection = { theme: null, enhancements: [], cssOnly: [] }
    const apply = vi.fn(async () => undefined)
    const controller: ThemeController = {
      entries: [{ key: 'test/theme', kind: 'theme', packageId: 'test', packageLabel: 'Test', version: '1', available: true,
        url: '/theme.css', definition: { id: 'theme', label: 'Theme', css: 'theme.css', moduleId: 'theme', supportsCssOnly: true } }],
      selection, busy: false, apply, authorize: vi.fn(async () => undefined), setParameter: vi.fn(async () => undefined), reset: vi.fn(),
    }
    const { host, root } = mount()
    await act(async () => root.render(createElement(ThemeSettings, { controller, t })))
    const select = host.querySelector('select')!
    await act(async () => { select.value = 'test/theme'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(select.value).toBe('test/theme')
    expect(host.textContent).toContain(t('settings.themeAuthorizeJs'))
    expect(host.textContent).toContain(t('settings.themeApply'))
    const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    await act(async () => checkbox.click())
    expect(apply).toHaveBeenLastCalledWith({ theme: 'test/theme', enhancements: [], cssOnly: ['test/theme'] })
  })
})
