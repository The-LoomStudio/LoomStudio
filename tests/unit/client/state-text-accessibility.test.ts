import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Card } from '../../../apps/studio-client/src/entities/card.js'
import { StateAuthoringPanel } from '../../../apps/studio-client/src/features/state-variables/ui/state-authoring-panel.js'
import { PipelineWorkbenchView } from '../../../apps/studio-client/src/features/text-transforms/ui/pipeline-workbench-view.js'
import {
  TextTransformDetail,
  TextTransformExplorer,
  TextTransformPanel,
  useTextTransformController,
  type TextTransformController,
  type TextTransformProps,
} from '../../../apps/studio-client/src/features/text-transforms/ui/text-transform-panel.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import { enUS } from '../../../apps/studio-client/src/shared/i18n/en-us.js'
import { zhCN } from '../../../apps/studio-client/src/shared/i18n/zh-cn.js'

const api = {} as TextTransformProps['api']
const card: Card = {
  id: 'card-1', version: 1, name: 'User content unchanged',
  opening: { entries: [] }, settingLayer: { entries: [] }, createdAt: 'now', updatedAt: 'now',
}
const noop = () => undefined

describe.each(['en-US', 'zh-CN'] as const)('State/Text accessibility (%s)', locale => {
  const t = createTranslator(locale)
  function renderDetail(patch: Partial<TextTransformController>, explorer = false) {
    function View() {
      const controller = { ...useTextTransformController({ api, t }), ...patch }
      return createElement(explorer ? TextTransformExplorer : TextTransformDetail, { controller })
    }
    return renderToStaticMarkup(createElement(View))
  }

  it('names the Card source editor and localizes the workbench resize control', () => {
    const html = renderToStaticMarkup(createElement(StateAuthoringPanel, {
      t, card, onSaveCard: async () => card,
    }))
    expect(html).toContain(`aria-label="${t('stateAuthoring.cardConfig')}"`)
    expect(html).toContain(`aria-label="${t('stateVariables.resizeSidebar')}"`)
    expect(html).toContain(card.name)
    expect(html).toContain('stateTemplates:') // Serialized fields are not translated.
    if (locale === 'en-US') expect(html).not.toMatch(/[\u3400-\u9fff]/)
  })

  it('localizes assembly errors without translating user IDs', () => {
    const html = renderToStaticMarkup(createElement(StateAuthoringPanel, {
      t,
      card: {
        ...card,
        timelineStateEntities: [{ typeId: 'unknown-type', entityId: 'user-entity' }],
        timelineComponentMounts: [{
          componentKey: 'user-mount', templateId: 'missing', templateVersion: 1,
          target: { kind: 'entity-type', typeId: 'unknown-type' },
        }],
        timelineStateBindings: [{ path: 'user.path', templateId: 'missing', templateVersion: 1 }],
      },
      onSaveCard: async () => card,
    }))
    expect(html).toContain(t('stateAuthoring.unknownEntityType', { entity: 'user-entity', type: 'unknown-type' }))
    expect(html).toContain(t('stateAuthoring.unknownMountComponent', { mount: 'user-mount', component: 'missing' }))
    expect(html).toContain(t('stateAuthoring.unknownPathComponent', { path: 'user.path', component: 'missing' }))
  })

  it.each(['rule', 'extractor'] as const)('names the %s JSON editor and document ID', kind => {
    const title = t(kind === 'rule' ? 'textTransform.ruleTitle' : 'textTransform.extractorTitle')
    const html = renderDetail({
      selectedTarget: { kind, id: 'document-1' },
      selectedRuleId: 'document-1', selectedExtractorId: 'document-1',
      ruleText: '{"name":"USER RULE","matcher":{"kind":"regex"}}',
      extractorText: '{"name":"USER EXTRACTOR","parser":"key-value-lines"}',
    })
    expect(html).toContain(`aria-label="${t('textTransform.documentId')}"`)
    expect(html).toContain(`aria-label="${t('textTransform.jsonEditor', { title })}"`)
    expect(html).toContain(kind === 'rule' ? 'USER RULE' : 'USER EXTRACTOR')
    expect(html).toContain(kind === 'rule' ? 'regex' : 'key-value-lines')
    if (locale === 'en-US') expect(html).not.toMatch(/[\u3400-\u9fff]/)
  })

  it('names read-only resolved script source', () => {
    const html = renderDetail({
      selectedTarget: { kind: 'script', id: 'script-1' },
      resolvedMounts: [{
        mountId: 'mount-1', enabled: true, orderIndex: 0, grantedCapabilities: [], source: '// USER SOURCE',
        script: { id: 'script-1', version: 1, name: 'USER SCRIPT', metadataId: 'user-script', scriptVersion: '1.0.0', requestedCapabilities: [], contributions: [] },
      }],
    })
    expect(html).toContain(`aria-label="${t('textTransform.source')}"`)
    expect(html).toContain('readOnly=""')
    expect(html).toContain('// USER SOURCE')
  })

  it('names editable script file and source controls', () => {
    const html = renderDetail({
      selectedTarget: { kind: 'script', id: 'script-1' },
      visibleScripts: [{
        script: {
          id: 'script-1', version: 1, name: 'USER SCRIPT', metadataId: 'user-script',
          requestedCapabilities: [], contributions: [],
        },
        mount: { enabled: true, orderIndex: 0, grantedCapabilities: [] },
      }] as TextTransformController['visibleScripts'],
      scriptFileName: 'user.loom.js', scriptSource: '// USER SOURCE',
    })
    expect(html).toContain(`aria-label="${t('textTransform.scriptFileName')}"`)
    expect(html).toContain(`aria-label="${t('textTransform.source')}"`)
    expect(html).toContain(`aria-label="${t('textTransform.order')}"`)
    expect(html).toContain('user.loom.js')
  })

  it('exposes a named native import button and file input', () => {
    const html = renderDetail({ loomScriptsApi: {} as NonNullable<TextTransformProps['loomScriptsApi']> }, true)
    const label = t('textTransform.importScript')
    expect(html).toMatch(new RegExp(`<button[^>]*aria-label="${label}"[^>]*type="button"`))
    expect(html).toMatch(new RegExp(`<input[^>]*aria-label="${label}"[^>]*type="file"`))
  })

  it('names runtime context and filters and localizes status options', () => {
    const html = renderToStaticMarkup(createElement(TextTransformPanel, {
      api, t, owner: { kind: 'runtime' },
      runtimeContexts: [
        { id: 'one', label: 'USER CONTEXT ONE', source: { kind: 'agent-session', sessionId: 'one' } },
        { id: 'two', label: 'USER CONTEXT TWO', source: { kind: 'agent-session', sessionId: 'two' } },
      ],
    }))
    for (const key of ['currentContext', 'filterOwner', 'filterEffect', 'filterStatus', 'search'] as const) {
      expect(html).toContain(`aria-label="${t(`textTransform.${key}`)}"`)
    }
    for (const status of ['active', 'disabled', 'degraded', 'conflict'] as const) {
      expect(html).toContain(`<option value="${status}">${t(`textTransform.status.${status}`)}</option>`)
    }
    expect(html).toContain('USER CONTEXT TWO')
    if (locale === 'en-US') expect(html).not.toMatch(/[\u3400-\u9fff]/)
  })

  it('localizes status badges while retaining data-status values', () => {
    const statuses = ['active', 'disabled', 'degraded', 'conflict'] as const
    const html = renderToStaticMarkup(createElement(PipelineWorkbenchView, {
      t, ariaLabel: 'Pipeline', groups: [{
        id: 'rules', label: 'USER GROUP', items: statuses.map(status => ({
          id: status, kind: 'rule', label: 'USER RULE', description: 'regex', owner: 'user', status,
        })),
      }],
      searchValue: '', searchPlaceholder: t('textTransform.search'), searchClearLabel: t('textTransform.clearSearch'),
      emptyLabel: '', backLabel: t('textTransform.backToSettings'), mobilePane: 'master', detail: null,
      onSearchChange: noop, onSelect: noop, onMobilePaneChange: noop,
    }))
    for (const status of statuses) {
      expect(html).toContain(`data-status="${status}">${t(`textTransform.status.${status}`)}</span>`)
    }
  })

  it.each(['match', 'artifact'] as const)('localizes the %s detail heading', kind => {
    const html = renderDetail({ selectedTarget: { kind, id: 'item-1' } })
    expect(html).toContain(`<h3>${t(kind === 'match' ? 'textTransform.matchTitle' : 'textTransform.artifactTitle')}</h3>`)
  })
})

it('keeps State/Text translation keys and parameter names aligned', () => {
  const inScope = (key: string) => /^(stateVariables|stateAuthoring|textTransform)\./.test(key)
  const keys = Object.keys(zhCN).filter(inScope) as Array<keyof typeof zhCN>
  expect(Object.keys(enUS).filter(inScope).sort()).toEqual([...keys].sort())
  for (const key of keys) {
    expect(enUS[key]).not.toMatch(/[\u3400-\u9fff]/)
    expect(enUS[key].match(/\{\{[^}]+\}\}/g)?.sort() ?? [])
      .toEqual(zhCN[key].match(/\{\{[^}]+\}\}/g)?.sort() ?? [])
  }
})
