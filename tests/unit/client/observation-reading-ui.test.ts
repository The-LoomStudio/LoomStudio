// @vitest-environment happy-dom
import { ObservationSourceIcon } from '../../../apps/studio-client/src/widgets/log-viewer/observation-source-icon.js'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { useStudioLayoutStore } from '../../../apps/studio-client/src/shared/studio-shell/studio-layout-store.js'
import { act, createElement as h, createRef, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import { ObservationMessageCard } from '../../../apps/studio-client/src/features/observability/ui/observation-messages.js'
import { ObservationSources } from '../../../apps/studio-client/src/features/observability/ui/observation-sources.js'
import { ToolResult } from '../../../apps/studio-client/src/features/observability/ui/observation-content.js'
import { ObservabilityWorkbench } from '../../../apps/studio-client/src/widgets/log-viewer/observability-workbench.js'
import { observationFixtures } from '../../../apps/studio-client/src/dev-preview/observability-fixtures.js'
const t = createTranslator('zh-CN')
beforeEach(() => useStudioLayoutStore.setState({ viewPreferences: {} }))
let root: Root
let host: HTMLDivElement
async function mount(content: ReactNode) {
  host = document.createElement('div'); document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(content))
}
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove() })
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

it('keeps the first tool response visible and allows the changes switch without a prior request', async () => {
  await mount(h(ObservabilityWorkbench, { records: observationFixtures }))
  await act(async () => [...host.querySelectorAll('button')].find(item => item.textContent?.includes('钟楼下的重逢'))!.click())
  const toggle = [...host.querySelectorAll('button')].find(item => item.textContent === '显示全部消息')!
  expect(toggle.disabled).toBe(false)
  expect(host.textContent).toContain(t('observation.tokenOverview'))
  const tool = [...host.querySelectorAll('fieldset')].find(item => item.textContent?.includes('codeact_json'))!
  expect(tool.closest('details')).toBeNull()
  expect(tool.textContent).toContain("cannot read property '日期'")
  await act(async () => toggle.click())
  expect(host.textContent).toContain(t('observation.sendOrder'))
  await act(async () => [...host.querySelectorAll('button')].find(item => item.textContent === '只看变化消息')!.click())
  await act(async () => [...host.querySelectorAll('button')].find(item => item.textContent?.includes('2 · 输出文本'))!.click())
  const output = [...host.querySelectorAll('fieldset')].find(item => item.textContent?.includes('雨水沿着钟楼'))!
  expect(output.closest('details')).toBeNull()
  expect(host.textContent).toContain(t('observation.tokenOverview'))
})

it('expands recorded resource groups, keeps unused closed, and uses anchor IDs and authoring icon colors', async () => {
  await mount(h(ObservationSources, { renderSourceIcon: input => h(ObservationSourceIcon, input), sources: observationFixtures[0].steps[0].sources, onSelect: () => {}, scroller: createRef<HTMLElement>(), t }))
  const groups = [...host.querySelectorAll('details')]
  const unused = groups.filter(item => item.querySelector(':scope > summary')?.textContent?.startsWith('未采用'))
  expect(unused.length).toBeGreaterThan(0)
  expect(unused.every(item => !item.open)).toBe(true)
  expect(groups.filter(item => !unused.includes(item)).every(item => item.open)).toBe(true)
  expect(host.textContent).toContain('@lore.stable')
  const resident = host.querySelector('[title="常驻 (Always)"]') as HTMLElement
  const conditional = host.querySelector('[title="条件/关键词触发 (Conditional)"]') as HTMLElement
  expect(resident.style.color).toContain('--loom-color-info')
  expect(conditional.style.color).toContain('--loom-color-success')
})

it('keeps entry content expanded and opens the full diff only in its dialog', async () => {
  const original = Array.from({ length: 24 }, (_, index) => `Line ${index}`).join('\n')
  const entry = { ...observationFixtures[0].steps[0].sources[0], original, rendered: original.replace('Line 12', 'Changed 12') }
  await mount(h(ObservationSources, { renderSourceIcon: input => h(ObservationSourceIcon, input), sources: [entry], selectedId: entry.id, onSelect: () => {}, scroller: createRef<HTMLElement>(), t }))
  expect(host.querySelector('[data-loom-component="read-only-diff"]')).toBeNull()
  const trigger = [...host.querySelectorAll('button')].find(item => item.textContent === t('observation.originalAndChanges'))!
  expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
  await act(async () => {
    trigger.click()
    // Await the actual lazy module instead of assuming it loads within 100 ms.
    await import('../../../apps/studio-client/src/shared/ui/read-only-diff/read-only-diff.js')
  })
  expect(host.querySelector('dialog')?.open).toBe(true)
  const collapse = [...host.querySelectorAll('button')].find(item => item.textContent === t('observation.collapseText'))!
  expect(collapse.getAttribute('aria-expanded')).toBe('true')
  const diff = host.querySelector('[data-loom-component="read-only-diff"]')!
  expect(diff.querySelector('button')?.getAttribute('aria-expanded')).toBe('true')
  expect(diff.querySelector('.cm-collapsedLines')).toBeNull()
  expect(diff.closest('dialog')).not.toBeNull()
  const diffDialog = diff.closest('dialog')!
  await act(async () => diffDialog.dispatchEvent(new Event('cancel', { cancelable: true })))
  expect(diffDialog.open).toBe(false)
  expect(host.querySelector('dialog')?.open).toBe(true)
  expect(host.querySelector('[data-loom-component="read-only-diff"]')).toBeNull()
})

it('opens raw records and tool evidence in dialogs without adding JSON to the reading flow', async () => {
  await mount(h(ObservabilityWorkbench, { records: observationFixtures }))
  await act(async () => [...host.querySelectorAll('button')].find(item => item.textContent?.includes('钟楼下的重逢'))!.click())
  expect([...host.querySelectorAll('pre')].some(item => item.textContent?.includes('"preparedMessages"'))).toBe(false)
  const rawRecord = [...host.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === t('observation.raw'))!
  await act(async () => rawRecord.click())
  let dialog = host.querySelector<HTMLDialogElement>('dialog[open]')!
  expect(dialog.querySelector('pre')?.textContent).toContain('"step-1"')
  expect([...host.querySelectorAll('pre')].filter(item => item.textContent?.includes('"step-1"')).every(item => item.closest('dialog'))).toBe(true)
  await act(async () => dialog.querySelector<HTMLButtonElement>(`button[aria-label="${t('observation.close')}"]`)!.click())
  expect(host.querySelector('dialog[open]')).toBeNull()
  expect(host.textContent).not.toContain('"step-1"')
  const rawTool = [...host.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === t('observation.rawTool'))!
  await act(async () => rawTool.click())
  dialog = host.querySelector<HTMLDialogElement>('dialog[open]')!
  expect(dialog.querySelector('pre')?.textContent).toContain('"tool-invocation-example"')
  await act(async () => dialog.dispatchEvent(new Event('cancel', { cancelable: true })))
  expect(host.querySelector('dialog[open]')).toBeNull()
})

it('opens an explicitly linked record outside the loaded list and keeps raw identities in its information dialog', async () => {
  let opened = false
  const linked = { ...observationFixtures[0], id: 'linked-build', title: 'Linked historical build', references: [{ label: 'Current provider name', open: () => { opened = true } }] }
  await mount(h(ObservabilityWorkbench, { records: [], selectedRecordId: linked.id, selectedRecord: linked }))
  expect(host.querySelector('h2')?.textContent).toContain('Linked historical build')
  expect([...host.querySelectorAll('details')].some(item => item.querySelector(':scope > summary')?.textContent === t('observation.identifiers'))).toBe(false)
  expect(host.querySelector('dialog[open]')).toBeNull()
  await act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="${t('observation.identifiers')}"]`)!.click())
  expect(host.querySelector('dialog[open]')?.textContent).toContain(linked.id)
  await act(async () => [...host.querySelectorAll('button')].find(item => item.textContent?.includes('Current provider name'))!.click())
  expect(opened).toBe(true)
})

it('reads narrative text first while retaining partial-read evidence and identities in dialogs', async () => {
  const sample = { timelineId: 'timeline-evidence', branchId: 'branch-evidence', readHeadNodeId: 'head-evidence',
    text: 'Recorded narrative body', nodes: [{ text: 'Recorded node', id: 'node-evidence' }], complete: false, nextBeforeFloor: 3, extraField: 'Extra evidence' }
  await mount(h(ToolResult, { value: { content: [{ type: 'text', text: JSON.stringify(sample) }] }, t }))
  expect(host.textContent?.startsWith(sample.text)).toBe(true)
  expect(host.textContent).toContain('部分读取')
  expect(host.textContent).toContain('nextBeforeFloor')
  expect(host.textContent).toContain('Extra evidence')
  expect(host.textContent).not.toContain('timeline-evidence')
  await act(async () => [...host.querySelectorAll('button')].find(item => item.textContent === '读取定位')!.click())
  const dialog = host.querySelector<HTMLDialogElement>('dialog[open]')!
  expect(dialog.textContent).toContain('timeline-evidence')
  expect(dialog.textContent).toContain('head-evidence')
  await act(async () => dialog.dispatchEvent(new Event('cancel', { cancelable: true })))
  await act(async () => [...host.querySelectorAll('button')].find(item => item.textContent === '节点明细 · 1')!.click())
  expect(host.querySelector('dialog[open]')?.textContent).toContain('Recorded node')
  expect(host.querySelector('dialog[open]')?.textContent).toContain('node-evidence')
})

it('does not hide arbitrary ID fields or reinterpret unparseable tool text', async () => {
  const payload = { orderId: 'business-id', timelineId: 'not-a-narrative-result', text: 'Plain tool body', warning: 'Keep this warning' }
  await mount(h(ToolResult, { value: { content: [{ type: 'text', text: JSON.stringify(payload) }, { type: 'text', text: '{truncated' }] }, t }))
  expect(host.textContent?.startsWith(payload.text)).toBe(true)
  expect(host.textContent).toContain(payload.orderId)
  expect(host.textContent).toContain(payload.timelineId)
  expect(host.textContent).toContain(payload.warning)
  expect(host.textContent).toContain('{truncated')
  expect(host.querySelector('dialog')).toBeNull()
})


it('keeps long messages brief and exposes full content and raw evidence through the same info dialog', async () => {
  const content = 'context '.repeat(500) + 'END_OF_MESSAGE'
  await mount(h(ObservationMessageCard, { message: { id: 'long', role: 'system', content, raw: { role: 'system', content, evidence: 'raw-only-field' } }, tokens: 501, onSource: () => {}, t }))
  expect(host.textContent).not.toContain('END_OF_MESSAGE')
  expect(host.textContent).toContain('501 tokens')
  expect([...host.querySelectorAll('button')].some(item => item.textContent === t('observation.expandText'))).toBe(false)
  await act(async () => (host.querySelector('button[aria-haspopup="dialog"]') as HTMLButtonElement).click())
  expect(host.querySelector('dialog')?.textContent).toContain('END_OF_MESSAGE')
  expect(host.querySelector('dialog')?.textContent).not.toContain('raw-only-field')
  await act(async () => [...host.querySelectorAll('button')].find(item => item.textContent === t('observation.rawMessage'))!.click())
  expect(host.querySelector('dialog')?.textContent).toContain('raw-only-field')
})


it('shows recorded roles in the source tree and keeps the tree visible behind source details', async () => {
  const entry = { ...observationFixtures[0].steps[0].sources[0], id: 'session-entry', title: 'Message 6', included: true, injections: [
    { id: 'assistant-part', role: 'assistant', rendered: 'Calling a tool' },
    { id: 'tool-part', role: 'tool', rendered: 'Tool result' },
  ] }
  await mount(h(ObservationSources, { renderSourceIcon: input => h(ObservationSourceIcon, input), sources: [entry], selectedId: entry.id, onSelect: () => {}, scroller: createRef<HTMLElement>(), t }))
  const leaf = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Message 6'))!
  expect(leaf.closest('dialog')).toBeNull()
  expect(leaf.closest('[hidden]')).toBeNull()
  expect(leaf.textContent).toContain(t('observation.tokens.assistant'))
  expect(leaf.textContent).toContain(t('observation.tokens.tool'))
  expect(leaf.textContent).toContain(t('observation.tokenUnknown'))
  expect(host.querySelector('dialog')?.open).toBe(true)
})


it('filters the existing source tree through the overview legend and clears that filter', async () => {
  const base = observationFixtures[0].steps[0].sources[0]
  const sources = [
    { ...base, id: 'first', title: 'First source', included: true, injections: [{ id: 'one', targetAnchorId: '@a', rendered: 'alpha' }] },
    { ...base, id: 'second', title: 'Second source', included: true, injections: [{ id: 'two', targetAnchorId: '@b', rendered: 'beta' }] },
  ]
  await mount(h(ObservationSources, { renderSourceIcon: input => h(ObservationSourceIcon, input), sources, onSelect: () => {}, scroller: createRef<HTMLElement>(), t }))
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent?.startsWith('@a'))!.click())
  expect(host.textContent).toContain('First source')
  expect(host.textContent).not.toContain('Second source')
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === t('observation.clearTokenFilter'))!.click())
  expect(host.textContent).toContain('Second source')
})


it('shows execution status in the message row and separates tool request from output in its dialog', async () => {
  await mount(h(ObservationMessageCard, { message: { id: 'tool', role: 'tool', content: 'operation failed', exchanges: [{ callId: 'call', name: 'write', input: { path: '/example' }, result: 'operation failed', status: 'failed' }] }, onSource: () => {}, t }))
  expect(host.textContent).toContain(t('observation.failed'))
  expect(host.textContent).toContain('write')
  await act(async () => (host.querySelector('button[aria-haspopup="dialog"]') as HTMLButtonElement).click())
  const dialog = host.querySelector('dialog')!
  expect(dialog.textContent).toContain(t('observation.toolRequest'))
  expect(dialog.textContent).toContain('/example')
  expect(dialog.textContent).toContain(t('observation.toolOutput'))
  expect(dialog.querySelector('[data-failed="true"]')?.textContent).toContain('operation failed')
})
