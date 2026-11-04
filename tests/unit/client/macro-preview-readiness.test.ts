// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MacroInspection } from '@loom-studio/shared'
import { useMacroPreview } from '../../../apps/studio-client/src/features/prompt-build/model/use-macro-preview.js'

const roots: ReturnType<typeof createRoot>[] = []
beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  vi.unstubAllGlobals()
})

const inspection: MacroInspection = {
  snapshot: { global: {}, computed: {}, aliases: {} }, entries: [], capturedAt: 'ready',
}

async function mount(inspect = vi.fn(async () => ({ macroInspection: inspection }))) {
  let input: Parameters<typeof useMacroPreview>[0] = {
    api: { inspect, getConfig: vi.fn(), updateConfig: vi.fn() },
    ready: false, key: 'initial', resourceRevision: [], selections: {},
  }
  let result!: ReturnType<typeof useMacroPreview>
  const root = createRoot(document.createElement('div'))
  roots.push(root)
  function Harness() { result = useMacroPreview(input); return null }
  async function render(patch: Partial<typeof input> = {}) {
    input = { ...input, ...patch }
    await act(async () => root.render(createElement(Harness)))
  }
  await render()
  return { inspect, render, read: () => result }
}

it('waits for initial dependencies and inspects the latest context once they are ready', async () => {
  const f = await mount()
  await f.render({ key: 'user:loaded', resourceRevision: ['resources'], cardId: 'card' })
  expect(f.inspect).not.toHaveBeenCalled()
  expect(f.read().preview).toEqual({ key: 'user:loaded', loading: true })
  await f.render({ ready: true, timelineId: 'timeline', branchId: 'branch', presetId: 'preset' })
  expect(f.inspect).toHaveBeenCalledTimes(1)
  expect(f.inspect).toHaveBeenLastCalledWith({ timelineTarget: { timelineId: 'timeline', branchId: 'branch' }, presetId: 'preset' })
  expect(f.read().preview.inspection).toBe(inspection)
  await f.render()
  expect(f.inspect).toHaveBeenCalledTimes(1)
})

it('keeps real invalidations and manual refresh after initial readiness', async () => {
  const f = await mount()
  await f.render({ ready: true, cardId: 'card', cardVersion: 1 })
  await f.render({ resourceRevision: ['updated'] })
  await f.render({ cardVersion: 2 })
  await f.render({ lastRunId: 'completed-run' })
  await f.render({ selections: { tone: { sourceId: 'preset:p' } } })
  await act(async () => f.read().refresh())
  expect(f.inspect).toHaveBeenCalledTimes(6)
  expect(f.inspect).toHaveBeenLastCalledWith({ cardId: 'card', presetId: undefined, macroSelections: { tone: { sourceId: 'preset:p' } } })
})

it('rejects an old response while dependencies are unavailable and retains retry feedback', async () => {
  const old = Promise.withResolvers<{ macroInspection: MacroInspection }>()
  const inspect = vi.fn(async () => ({ macroInspection: inspection }))
    .mockImplementationOnce(() => old.promise)
    .mockRejectedValueOnce(new Error('inspect failed'))
  const f = await mount(inspect)
  await f.render({ ready: true })
  await f.render({ ready: false, key: 'new-context' })
  await act(async () => old.resolve({ macroInspection: inspection }))
  expect(f.read().preview).toEqual({ key: 'new-context', loading: true })
  await f.render({ ready: true })
  expect(f.read().preview.error).toBe('inspect failed')
  await act(async () => f.read().refresh())
  expect(f.read().preview.error).toBeUndefined()
  expect(f.read().preview.inspection).toBe(inspection)
})
