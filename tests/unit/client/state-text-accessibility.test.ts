import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Card } from '../../../apps/studio-client/src/entities/card.js'
import { ScriptManagementPanel } from '../../../apps/studio-client/src/features/loom-scripts/ui/script-management-panel.js'
import { createScriptManagementPreviewApi } from '../../../apps/studio-client/src/dev-preview/script-management-fixtures.js'
import { playerEntityType } from '@loom-studio/shared'
import { StateAuthoringPanel } from '../../../apps/studio-client/src/features/state-variables/ui/state-authoring-panel.js'
import { PipelineWorkbenchView } from '../../../apps/studio-client/src/features/text-transforms/ui/pipeline-workbench-view.js'
import {
  TextTransformDetail,
  TextTransformExplorer,
  TextTransformPanel,
  useTextTransformController,
  type TextTransformController,
  type TextTransformProps,
} from '../../../apps/studio-client/src/widgets/text-transform-workbench/text-transform-panel.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import { enUS } from '../../../apps/studio-client/src/shared/i18n/en-us.js'
import { zhCN } from '../../../apps/studio-client/src/shared/i18n/zh-cn.js'

const api = {} as TextTransformProps['api']
const card: Card = {
  id: 'card-1', artifactId: 'fixture-artifact', version: 1, name: 'User content unchanged',
  opening: { id: 'root-opening', content: '' }, lore: { entries: [] }, createdAt: 'now', updatedAt: 'now',
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
    expect(html).toContain('stateTemplates:') // Serialized fields are not translated.
    if (locale === 'en-US') expect(html.replaceAll(playerEntityType.label!, '')).not.toMatch(/[\u3400-\u9fff]/)
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

  it('keeps a missing entity type selected instead of displaying another option', () => {
    const html = renderToStaticMarkup(createElement(StateAuthoringPanel, {
      t,
      card: {
        ...card,
        timelineStateEntities: [{ typeId: 'deleted-type', entityId: 'kept-entity' }],
      },
      onSaveCard: async () => { throw new Error('Rendering must not save') },
    }))
    expect(html).toMatch(/<option[^>]*value="deleted-type"[^>]*selected=""[^>]*>deleted-type<\/option>/)
    expect(html).toMatch(/<option[^>]*disabled=""[^>]*value="deleted-type"/)
    expect(html).toContain(t('stateAuthoring.unknownEntityType', { entity: 'kept-entity', type: 'deleted-type' }))
  })

  it('names the extractor JSON editor and document ID', () => {
    const title = t('textTransform.extractorTitle')
    const html = renderDetail({ selectedTarget: { kind: 'extractor', id: 'document-1' },
      selectedExtractorId: 'document-1', extractorText: '{"name":"USER EXTRACTOR","parser":"key-value-lines"}',
    })
    expect(html).toContain(`aria-label="${t('textTransform.documentId')}"`)
    expect(html).toContain(`aria-label="${t('textTransform.jsonEditor', { title })}"`)
    expect(html).toContain('USER EXTRACTOR')
    expect(html).toContain('key-value-lines')
    if (locale === 'en-US') expect(html).not.toMatch(/[\u3400-\u9fff]/)
  })

  it('shows a localized rule summary instead of the retired JSON editor', () => {
    const html = renderDetail({ selectedTarget: { kind: 'rule', id: 'document-1' }, selectedRuleId: 'document-1',
      rules: [{ id: 'document-1', version: 2, name: 'USER RULE', owner: { kind: 'workspace' }, enabled: true,
        orderIndex: 0, matcher: { kind: 'regex', pattern: 'USER_PATTERN', flags: 'g' },
        effect: { kind: 'replace', replacement: 'USER REPLACEMENT' }, targets: ['narrative'], phases: ['display'],
        range: { minDepth: 1 }, createdAt: '', updatedAt: '',
      }],
    })
    expect(html).toContain('<h3>USER RULE</h3>')
    expect(html).toContain(t('textTransform.ruleSummaryVersion', { version: 2 }))
    expect(html).toContain('/USER_PATTERN/g')
    expect(html).toContain('USER REPLACEMENT')
    expect(html).toContain(t('textTransform.ruleDepth', { min: 1, max: t('textTransform.ruleUnlimited') }))
    expect(html).not.toContain(t('textTransform.jsonEditor', { title: t('textTransform.ruleTitle') }))
    if (locale === 'en-US') expect(html).not.toMatch(/[\u3400-\u9fff]/)
  })

  it('names read-only resolved script source', () => {
    const html = renderDetail({
      selectedTarget: { kind: 'script', id: 'script-1' },
      resolvedMounts: [{
        mountId: 'mount-1', enabled: true, orderIndex: 0, grantedCapabilities: [], source: '// USER SOURCE',
        script: { id: 'script-1', version: 1, name: 'USER SCRIPT', metadataId: 'user-script', runtime: 'client', scriptVersion: '1.0.0', requestedCapabilities: [], contributions: [] },
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
          owner: { kind: 'user' }, formatVersion: 1, scriptVersion: '1.0.0', runtime: 'client-sandbox',
          source: { blobId: 'blob-1', mediaType: 'text/javascript', fileName: 'user.loom.js' },
          sourceDigest: 'digest', createdAt: '', updatedAt: '',
          requestedCapabilities: [], contributions: [],
        },
        mount: {
          id: 'mount-1', version: 1, target: { kind: 'user' }, scriptDocumentId: 'script-1',
        enabled: true, runtimeRevision: 1, adoptedDocumentVersion: 1, adoptedSettings: {}, orderIndex: 0, grantedCapabilities: [], origin: {}, createdAt: '', updatedAt: '',
        },
      }],
      scriptFileName: 'user.loom.js', scriptSource: '// USER SOURCE',
    })
    expect(html).toContain(`aria-label="${t('textTransform.scriptFileName')}"`)
    expect(html).toMatch(new RegExp(`<span[^>]*id="[^"]+">${t('textTransform.source')}</span>`))
    expect(html).toContain(`aria-label="${t('textTransform.order')}"`)
    expect(html).toContain('user.loom.js')
  })

  it('exposes a named native import button and file input', () => {
    const html = renderToStaticMarkup(createElement(ScriptManagementPanel, {
      api: createScriptManagementPreviewApi(), onScriptsChanged: noop, t,
    }))
    expect(html).toMatch(/<button[^>]*aria-label="导入脚本或规则"[^>]*type="button"/)
    expect(html).toMatch(/<input[^>]*type="file"[^>]*aria-label="导入脚本"/)
    expect(html).toContain('accept=".loom.js,.js,.md,text/javascript,text/markdown"')
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
          id: status, kind: 'rule' as const, label: 'USER RULE', description: 'regex', owner: 'user', status,
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
