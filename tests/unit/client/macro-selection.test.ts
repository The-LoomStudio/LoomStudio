import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import { useMacroSelection } from '../../../apps/studio-client/src/features/prompt-build/model/use-macro-selection.js'

let activeClient: QueryClient | undefined
afterEach(() => { activeClient?.clear() })

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  activeClient = client
  const api: StudioApi['macros'] = {
    inspect: vi.fn(),
    getConfig: vi.fn(async target => ({ config: {
      ...target, version: 3, macroSelections: { tone: { sourceId: 'preset:p' } },
    } })),
    updateConfig: vi.fn(async input => ({
      config: { timelineId: input.timelineId, presetId: input.presetId, version: input.expectedVersion + 1, macroSelections: input.macroSelections },
      mutation: { changesetId: 'saved' },
    })),
  }
  let endpoint = 'server-a'
  let timelineId = 'story'
  const render = () => {
    let state!: ReturnType<typeof useMacroSelection>
    function Consumer() {
      state = useMacroSelection({ api, endpoint, timelineId, presetId: 'p', cardId: 'card' })
      return null
    }
    renderToString(createElement(QueryClientProvider, { client }, createElement(Consumer)))
    return state
  }
  return { api, client, render, target: (server: string, story: string) => { endpoint = server; timelineId = story } }
}

describe('persistent macro selection', () => {
  it('loads one Timeline/Preset selection for all branches and saves structured references without overriding server builds', async () => {
    const f = setup()
    const key = f.render().targetKey('story', 'branch-a')
    expect(f.render().targetKey('story', 'branch-b')).toBe(key)
    await f.render().refresh()
    expect(f.render().readSelections(key)).toEqual({ tone: { sourceId: 'preset:p' } })
    await f.render().selectSource(key, 'Tone', { sourceId: 'preset:p', optionId: 'gentle' })
    expect(f.api.updateConfig).toHaveBeenCalledWith({
      timelineId: 'story', presetId: 'p', expectedVersion: 3,
      macroSelections: { tone: { sourceId: 'preset:p', optionId: 'gentle' } },
    })
    expect(f.render().getSelections('story', 'branch-a')).toBeUndefined()
    await f.render().selectSource(key, 'tone', undefined)
    expect(f.api.updateConfig).toHaveBeenLastCalledWith(expect.objectContaining({ expectedVersion: 4, macroSelections: {} }))
  })

  it('keeps committed choices on save failure, does not retry and requires a successful read before saving', async () => {
    const f = setup()
    const key = f.render().targetKey('story')
    vi.mocked(f.api.getConfig).mockRejectedValueOnce(new Error('Read failed'))
    await f.render().refresh()
    await f.render().selectSource(key, 'tone', 'card:card')
    expect(f.api.updateConfig).not.toHaveBeenCalled()
    expect(f.render().readError(key)).toBe('Read failed')
    await f.render().refresh()
    vi.mocked(f.api.updateConfig).mockRejectedValueOnce(new Error('Version conflict'))
    await f.render().selectSource(key, 'tone', 'card:card')
    expect(f.client.getMutationCache().getAll().at(-1)?.state.error?.message).toBe('Version conflict')
    expect(f.render().readSelections(key)).toEqual({ tone: { sourceId: 'preset:p' } })
    expect(f.api.updateConfig).toHaveBeenCalledTimes(1)
  })

  it('does not publish an old save into a newly selected Timeline or endpoint', async () => {
    const f = setup()
    const key = f.render().targetKey('story')
    await f.render().refresh()
    let resolve!: (value: Awaited<ReturnType<StudioApi['macros']['updateConfig']>>) => void
    vi.mocked(f.api.updateConfig).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const pending = f.render().selectSource(key, 'tone', 'card:card')
    await f.render().selectSource(key, 'tone', 'preset:p')
    await Promise.resolve()
    expect(f.api.updateConfig).toHaveBeenCalledTimes(1)
    f.target('server-b', 'other-story')
    const otherKey = f.render().targetKey('other-story')
    await f.render().refresh()
    resolve({ config: { timelineId: 'story', presetId: 'p', version: 4, macroSelections: { tone: 'card:card' } }, mutation: { changesetId: 'saved' } })
    await pending
    expect(f.render().readSelections(otherKey)).toEqual({ tone: { sourceId: 'preset:p' } })
    expect(f.render().readSelections(key)).toEqual({})
    expect(f.client.getQueryData(['timeline-preset-macros', key])).toMatchObject({ version: 4, macroSelections: { tone: 'card:card' } })
  })

  it('cancels an in-flight old read before publishing a successful save', async () => {
    const f = setup()
    await f.render().refresh()
    const state = f.render()
    const key = state.targetKey('story')
    const save = Promise.withResolvers<Awaited<ReturnType<StudioApi['macros']['updateConfig']>>>()
    vi.mocked(f.api.updateConfig).mockReturnValueOnce(save.promise)
    const saving = state.selectSource(key, 'tone', 'card:card')
    const oldRead = Promise.withResolvers<Awaited<ReturnType<StudioApi['macros']['getConfig']>>['config']>()
    const reading = f.client.fetchQuery({
      queryKey: ['timeline-preset-macros', key], staleTime: 0, queryFn: () => oldRead.promise,
    }).catch(error => error)
    save.resolve({ config: { timelineId: 'story', presetId: 'p', version: 4, macroSelections: { tone: 'card:card' } }, mutation: { changesetId: 'saved' } })
    await saving
    oldRead.resolve({ timelineId: 'story', presetId: 'p', version: 3, macroSelections: {} })
    await reading
    expect(f.render().readSelections(key)).toEqual({ tone: 'card:card' })
  })
})
