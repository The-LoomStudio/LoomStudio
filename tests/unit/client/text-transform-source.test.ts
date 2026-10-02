import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement } from 'react'
import { SearchField } from '@loom-studio/ui'
import { useTextTransformController, type TextTransformProps } from '../../../apps/studio-client/src/features/text-transforms/ui/text-transform-panel.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import type { HistorySource, TextPipelineInspection, TextPipelineOverride, TextTransformRule } from '../../../apps/studio-client/src/entities/index.js'
import { MacroAuthoringExplorer, useMacroAuthoring, type MacroAuthoringSource } from '../../../apps/studio-client/src/features/state-variables/ui/macro-authoring-panel.js'
import { MacroInspectorPanel } from '../../../apps/studio-client/src/features/state-variables/ui/macro-inspector-panel.js'
import { PresetAnchorPicker } from '../../../apps/studio-client/src/features/context-assets/ui/context-asset-detail/preset-anchor-picker.js'
import type { PromptResource } from '../../../apps/studio-client/src/entities/index.js'

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[], effects: [] as (() => void)[] }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value
    }]
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = { current: initial }
    return hooks.values[index]
  },
  useMemo: (factory: () => unknown, deps: unknown[]) => {
    const index = hooks.cursor++
    const old = hooks.values[index] as { deps: unknown[]; value: unknown } | undefined
    if (!old || !deps.every((value, i) => Object.is(value, old.deps[i]))) hooks.values[index] = { deps, value: factory() }
    return (hooks.values[index] as { value: unknown }).value
  },
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const index = hooks.cursor++
    const previous = hooks.values[index] as { deps: unknown[]; cleanup?: () => void } | undefined
    if (previous && deps.every((item, i) => Object.is(item, previous.deps[i]))) return
    const entry = { deps, cleanup: undefined as (() => void) | undefined }
    hooks.values[index] = entry
    hooks.effects.push(() => { previous?.cleanup?.(); entry.cleanup = effect() || undefined })
  },
}))
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}
const a: HistorySource = { kind: 'narrative', timelineId: 'a', branchId: 'a-branch' }
const b: HistorySource = { kind: 'agent-session', sessionId: 'b' }
const baseOverride: TextPipelineOverride = {
  id: 'override', source: a, phase: 'display', version: 7,
  disabledRuleIds: ['current'], orderedRuleIds: ['current'], createdAt: '', updatedAt: '',
}
function inspection(source: HistorySource): TextPipelineInspection {
  return {
    source, phase: 'display', rules: [], extractors: [], artifacts: [],
    snapshot: { source, phase: 'display', entries: [], matches: [], diagnostics: [], ruleIds: [] },
  }
}
function fixture() {
  const inspectTextPipeline = vi.fn(async ({ source }: { source: HistorySource }) => inspection(source))
  const getOverride = vi.fn<TextTransformProps['api']['getOverride']>(async ({ source, phase }) => ({
    override: { ...baseOverride, source, phase },
  }))
  const upsertOverride = vi.fn<TextTransformProps['api']['upsertOverride']>(async ({ source, phase, disabledRuleIds, orderedRuleIds }) => ({
    override: { ...baseOverride, source, phase, version: 8, disabledRuleIds, orderedRuleIds },
    mutation: { changesetId: 'save-override' },
  }))
  const listRules = vi.fn<TextTransformProps['api']['listRules']>(async () => ({ rules: [] }))
  const props: TextTransformProps = {
    api: {
      inspectTextPipeline, getOverride, upsertOverride, listRules,
      listExtractors: async () => ({ extractors: [] }), listRenderers: async () => ({ renderers: [] }),
      getRule: async () => { throw new Error('Unexpected rule read') },
      upsertRule: async () => { throw new Error('Unexpected rule write') },
      deleteRule: async () => { throw new Error('Unexpected rule deletion') },
      getExtractor: async () => { throw new Error('Unexpected extractor read') },
      upsertExtractor: async () => { throw new Error('Unexpected extractor write') },
      deleteExtractor: async () => { throw new Error('Unexpected extractor deletion') },
      project: async () => { throw new Error('Unexpected projection') },
      previewCardOpening: async () => { throw new Error('Unexpected opening preview') },
      deleteOverride: async () => { throw new Error('Unexpected override deletion') },
      extract: async () => { throw new Error('Unexpected extraction') },
    },
    source: a, owner: { kind: 'runtime' }, t: createTranslator('en-US'),
  }
  function render() {
    hooks.cursor = 0
    const result = useTextTransformController(props)
    for (const effect of hooks.effects.splice(0)) effect()
    return result
  }
  async function settle() {
    for (let i = 0; i < 4; i++) await Promise.resolve()
    return render()
  }
  return { props, render, settle, inspectTextPipeline, getOverride, upsertOverride, listRules }
}
beforeEach(() => { hooks.cursor = 0; hooks.values = []; hooks.effects = [] })

describe('authoring search clear interactions', () => {
  function elements(value: unknown): ReactElement<Record<string, unknown>>[] {
    if (Array.isArray(value)) return value.flatMap(elements)
    if (!isValidElement<Record<string, unknown>>(value)) return []
    return [value, ...Object.values(value.props).flatMap(elements)]
  }

  it.each(['macro-author', 'macro-inspector', 'anchor'] as const)('clears %s filtering without selecting or saving business data', kind => {
    const t = createTranslator('en-US')
    const select = vi.fn()
    const save = vi.fn()
    const sources: MacroAuthoringSource[] = [{
      id: 'card', kind: 'card', label: 'Card', version: 1, macros: { visible: 'value' }, onSave: save,
    }]
    const render = () => {
      hooks.cursor = 0
      const tree = kind === 'macro-author'
        ? MacroAuthoringExplorer({ controller: useMacroAuthoring(sources, t) })
        : kind === 'macro-inspector'
          ? MacroInspectorPanel({
            t, loading: false, selections: {}, onSelectSource: select, onRefresh: save,
            inspection: { capturedAt: '', snapshot: { global: {}, computed: {}, aliases: {} }, entries: [{
              name: 'visible', status: 'resolved', value: 'value', candidates: [
                { sourceId: 'card', sourceKind: 'card', sourceLabel: 'Card', value: 'value' },
              ],
            }] },
          })
          : PresetAnchorPicker({
            t, onSelect: select, onClose: save,
            presets: [{ id: 'preset', rootNode: { id: 'visible', kind: 'virtual', label: 'Visible' } } as PromptResource],
          })
      for (const effect of hooks.effects.splice(0)) effect()
      return elements(tree)
    }
    render()
    const before = render()
    const search = () => render().find(element => element.type === SearchField)!
    expect(search().props.value).toBe('')
    if (kind === 'anchor') expect(search().props.autoFocus).toBe(true)
    ;(search().props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'NOT_FOUND' } })
    expect(search().props.value).toBe('NOT_FOUND')
    if (kind === 'macro-author') expect(render().some(element => element.props.nodes)).toBe(false)
    else expect(render().filter(element => element.type === 'strong').length).toBeLessThan(before.filter(element => element.type === 'strong').length)
    ;(search().props.onClear as () => void)()
    expect(search().props.value).toBe('')
    if (kind === 'macro-author') expect(render().some(element => element.props.nodes)).toBe(true)
    else expect(render().filter(element => element.type === 'strong')).toHaveLength(before.filter(element => element.type === 'strong').length)
    expect(select).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })
})

describe('authoring source ownership regressions', () => {
  it.each([true, false])('binds script export and save to the latest selection (late A: %s)', async lateA => {
    const f = fixture()
    const aRead = deferred<any>()
    const bRead = deferred<any>()
    const update = vi.fn(async () => ({ script: { id: 'B', version: 2 } }))
    f.props.owner = { kind: 'workspace' }
    f.props.loomScriptsApi = {
      list: async () => ({ scripts: ['A', 'B'].map(id => ({ id, version: 1 })) }),
      listMounts: async () => ({ mounts: [] }),
      export: (id: string) => id === 'A' ? aRead.promise : bRead.promise,
      update,
    } as unknown as NonNullable<TextTransformProps['loomScriptsApi']>
    f.render()
    await f.settle()
    const first = f.render().selectScript('A')
    const second = f.render().selectScript('B')
    await f.render().saveScript()
    expect(update).not.toHaveBeenCalled()
    const finishA = async () => { aRead.resolve({ artifact: { source: 'source A', fileName: 'A.js' } }); await first }
    const finishB = async () => { bRead.resolve({ artifact: { source: 'source B', fileName: 'B.js' } }); await second }
    if (lateA) { await finishB(); await finishA() } else { await finishA(); await finishB() }
    await f.render().saveScript()
    expect(update).toHaveBeenCalledWith({ scriptDocumentId: 'B', expectedVersion: 1, source: 'source B', fileName: 'B.js' })
    const pending = deferred<any>()
    f.props.loomScriptsApi.export = () => pending.promise
    const reading = f.render().selectScript('A')
    f.props.owner = { kind: 'card', cardId: 'other' }
    f.render()
    pending.resolve({ artifact: { source: 'stale', fileName: 'stale.js' } })
    await reading
    await f.render().saveScript()
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('retains dirty macro rows and CAS version across external updates and failed save', async () => {
    const onSave = vi.fn(async () => { throw new Error('Version conflict') })
    let sources: MacroAuthoringSource[] = [{ id: 'card', kind: 'card', label: 'Card', version: 1, macros: { name: 'original' }, onSave }]
    const render = () => {
      hooks.cursor = 0
      const result = useMacroAuthoring(sources, createTranslator('en-US'))
      for (const effect of hooks.effects.splice(0)) effect()
      return result
    }
    render()
    const row = render().sourceRows.card![0]!
    render().updateRow('card', row.id, { value: 'UNSAVED' })
    sources = [{ ...sources[0]!, version: 2, label: 'renamed' }]
    render()
    sources = [{ ...sources[0]!, version: 3, macros: { name: 'external' } }]
    render()
    expect(render().sourceRows.card![0]!.value).toBe('UNSAVED')
    expect(render().draftVersions.card).toBe(1)
    await render().save('card')
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 1 }))
    expect(render().dirtySources.card).toBe(true)
    expect(render().sourceRows.card![0]!.value).toBe('UNSAVED')
    render().updateRow('card', row.id, { value: 'original' })
    sources = [{ ...sources[0]!, version: 4 }]
    render()
    expect(render().sourceRows.card![0]!.value).toBe('external')
    expect(render().draftVersions.card).toBe(4)
  })
})

describe('Text Transform rule saving', () => {
  const rule: TextTransformRule = {
    id: 'card-rule', version: 1, createdAt: '', updatedAt: '',
    name: 'HTML', enabled: true, orderIndex: 0, owner: { kind: 'card', cardId: 'card' },
    matcher: { kind: 'regex', pattern: '<status>(.*?)</status>', flags: 'gs' },
    effect: { kind: 'replace', replacement: '```\n<html>$1</html>\n```' },
    targets: ['narrative'], phases: ['display'],
  }
  async function editing() {
    const f = fixture()
    f.props.owner = { kind: 'card', cardId: 'card' }
    f.props.source = undefined
    f.props.onRuntimeChanged = vi.fn()
    f.listRules.mockResolvedValue({ rules: [rule] })
    f.render()
    await f.settle()
    f.render().selectRule(rule.id)
    f.render().setRuleText(JSON.stringify({ ...rule, effect: { kind: 'replace', replacement: '<html>$1</html>' } }))
    return f
  }

  it('publishes saved replacement once and retains committed version when refresh fails', async () => {
    const f = await editing()
    const pending = deferred<Awaited<ReturnType<TextTransformProps['api']['upsertRule']>>>()
    const upsert = vi.fn<TextTransformProps['api']['upsertRule']>(() => pending.promise)
    f.props.api.upsertRule = upsert
    const controller = f.render()
    const saving = controller.saveRule()
    await controller.saveRule()
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(f.render().ruleSaving).toBe(true)
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 1, rule: expect.objectContaining({ effect: { kind: 'replace', replacement: '<html>$1</html>' } }),
    }))
    f.listRules.mockRejectedValue(new Error('Refresh failed'))
    pending.resolve({ rule: { ...rule, version: 2 }, mutation: { changesetId: 'saved' } })
    await saving
    expect(f.props.onRuntimeChanged).toHaveBeenCalledTimes(1)
    expect(f.render()).toMatchObject({ ruleSaved: true, ruleSaving: false, error: 'Refresh failed' })
    await f.render().saveRule()
    expect(upsert.mock.calls[1]?.[0].expectedVersion).toBe(2)
  })

  it('keeps edits and exposes write failure without announcing a preview change', async () => {
    const f = await editing()
    f.props.api.upsertRule = vi.fn(async () => { throw new Error('Version conflict') })
    const draft = f.render().ruleText
    await f.render().saveRule()
    expect(f.render()).toMatchObject({ ruleText: draft, ruleSaved: false, ruleSaving: false, error: 'Version conflict' })
    expect(f.props.onRuntimeChanged).not.toHaveBeenCalled()
  })

  it('lists more than ten rules and replaces a new draft with its saved catalog entry', async () => {
    const f = await editing()
    const existing = Array.from({ length: 12 }, (_, index) => ({ ...rule, id: `rule-${index}` }))
    f.listRules.mockResolvedValue({ rules: existing })
    await f.render().refresh()
    expect(f.render().finalOrder).toHaveLength(12)
    f.render().startNewRule()
    expect(f.render().unsavedNewRule).toBe(true)
    f.props.api.upsertRule = async ({ ruleId, rule: draft }) => {
      const created = { ...draft, id: ruleId, version: 1, createdAt: '', updatedAt: '' }
      f.listRules.mockResolvedValue({ rules: [...existing, created] })
      return { rule: created, mutation: { changesetId: 'new-rule' } }
    }
    await f.render().saveRule()
    expect(f.render().unsavedNewRule).toBe(false)
    expect(f.render().finalOrder).toHaveLength(13)
  })

  it('does not replace the selected editor after a late save for another card', async () => {
    const f = await editing()
    const pending = deferred<Awaited<ReturnType<TextTransformProps['api']['upsertRule']>>>()
    f.props.api.upsertRule = () => pending.promise
    const saving = f.render().saveRule()
    f.props.owner = { kind: 'card', cardId: 'other-card' }
    f.render()
    await f.settle()
    const current = f.render().ruleText
    pending.resolve({ rule: { ...rule, version: 2 }, mutation: { changesetId: 'saved' } })
    await saving
    expect(f.render()).toMatchObject({ ruleText: current, ruleSaved: false, ruleSaving: false })
  })
})

describe('Text Transform source isolation', () => {
  it('ignores a stale first-stage response without starting its override request', async () => {
    const f = fixture()
    const pending = deferred<TextPipelineInspection>()
    f.inspectTextPipeline.mockImplementationOnce(() => pending.promise)
    const old = f.render().inspect()
    f.props.source = b
    await f.render().inspect()
    pending.resolve(inspection(a))
    await old
    expect(f.render().inspection?.source).toEqual(b)
    expect(f.getOverride).toHaveBeenCalledTimes(1)
    expect(f.getOverride).toHaveBeenCalledWith(expect.objectContaining({ source: b }))
  })

  it('discards the automatic trace-detail response after switching source', async () => {
    const f = fixture()
    const initial = inspection(a)
    initial.snapshot.entries = [{
      id: 'a-entry', text: 'A', originalText: 'A', depth: 0, appliedRuleIds: [], promotedReasoning: [],
    }]
    const detail = deferred<TextPipelineInspection>()
    const started = deferred<void>()
    f.inspectTextPipeline.mockResolvedValueOnce(initial)
    f.inspectTextPipeline.mockImplementationOnce(() => { started.resolve(); return detail.promise })
    const old = f.render().inspect()
    await started.promise
    expect(f.inspectTextPipeline.mock.calls[1]?.[0]).toMatchObject({ source: a, traceEntryId: 'a-entry' })
    f.props.source = b
    await f.render().inspect()
    detail.resolve(initial)
    await old
    expect(f.getOverride).toHaveBeenCalledTimes(1)
    expect(f.render().inspection?.source).toEqual(b)
    expect(f.render().traceEntryId).toBe('')
  })

  it.each(['resolve', 'reject'] as const)('isolates late override %s and loading state', async outcome => {
    const f = fixture()
    const override = deferred<Awaited<ReturnType<typeof f.getOverride>>>()
    const started = deferred<void>()
    f.getOverride.mockImplementationOnce(() => { started.resolve(); return override.promise })
    const old = f.render().inspect()
    await started.promise
    expect(f.render().inspection).toBeUndefined()
    f.props.source = b
    const currentResult = deferred<TextPipelineInspection>()
    f.inspectTextPipeline.mockImplementationOnce(() => currentResult.promise)
    const current = f.render().inspect()
    await f.settle()
    if (outcome === 'resolve') override.resolve({ override: { ...baseOverride, version: 99, disabledRuleIds: ['old'], orderedRuleIds: ['old'] } })
    else override.reject(new Error('Old source failure'))
    await old
    expect(f.render().busy).toBe(true)
    expect(f.render().error).toBe('')
    expect(f.render().disabledRuleIds).toEqual([])
    currentResult.resolve(inspection(b))
    await current
    expect(f.render().disabledRuleIds).toEqual(['current'])
    await f.render().saveOverride([], [])
    expect(f.upsertOverride).toHaveBeenCalledWith(expect.objectContaining({ source: b, expectedVersion: 7 }))
  })

  it('hides results immediately when API, consumer or phase changes', async () => {
    const f = fixture()
    await f.render().inspect()
    const previousController = f.render()
    expect(previousController.inspection).toBeDefined()
    f.props.api = { ...f.props.api }
    expect(f.render().inspection).toBeUndefined()
    await previousController.saveOverride()
    expect(f.upsertOverride).not.toHaveBeenCalled()
    await f.render().inspect()
    f.props.consumerAgentSessionId = 'new-consumer'
    expect(f.render().inspection).toBeUndefined()
    await f.render().inspect()
    f.render().setPhase('prompt')
    expect(f.render().inspection).toBeUndefined()
  })

  it('does not let an old save re-inspect or clear a new source and suppresses duplicate saves', async () => {
    const f = fixture()
    await f.render().inspect()
    const saved = deferred<Awaited<ReturnType<typeof f.upsertOverride>>>()
    f.upsertOverride.mockImplementationOnce(() => saved.promise)
    const oldController = f.render()
    const old = oldController.saveOverride(['old-edit'], [])
    await oldController.saveOverride(['duplicate'], [])
    expect(f.upsertOverride).toHaveBeenCalledTimes(1)
    f.props.source = b
    await f.render().inspect()
    const requestsBefore = f.inspectTextPipeline.mock.calls.length
    saved.resolve({ override: { ...baseOverride, version: 99, disabledRuleIds: ['old-edit'], orderedRuleIds: [] }, mutation: { changesetId: 'old-save' } })
    await old
    expect(f.inspectTextPipeline).toHaveBeenCalledTimes(requestsBefore)
    expect(f.render().inspection?.source).toEqual(b)
    expect(f.render().disabledRuleIds).toEqual(['current'])
  })
})
