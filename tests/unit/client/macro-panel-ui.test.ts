import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StudioMacroPanel } from '../../../apps/studio-client/src/app/studio-macro-panel.js'
import { MacroAuthoringDetail, MacroAuthoringExplorer, type MacroAuthoringController } from '../../../apps/studio-client/src/features/state-variables/ui/macro-authoring-panel.js'
import { MacroInspectorPanel } from '../../../apps/studio-client/src/features/state-variables/ui/macro-inspector-panel.js'
import { MacroEntryDetail } from '../../../apps/studio-client/src/features/state-variables/ui/macro-entry-detail.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

const t = createTranslator('zh-CN')
const controller: MacroAuthoringController = {
  sources: [{ id: 'preset-1', kind: 'preset', label: 'New Preset', version: 1, macros: {}, onSave: async () => ({ version: 2, macros: {} }) }],
  sourceRows: { 'preset-1': [{ id: 'row-1', name: 'writing.style', value: 'plain', options: [{ id: 'option-1', label: '文风', value: 'warm' }] }] },
  draftVersions: { 'preset-1': 1 },
  selectedNodeId: 'preset-1:row-1',
  dirtySources: { 'preset-1': false },
  error: '',
  t,
  selectNode: () => undefined,
  addRow: () => undefined,
  updateRow: () => undefined,
  removeRow: () => undefined,
  save: async () => undefined,
}
const inspection = {
  snapshot: { global: {}, computed: {}, aliases: {} },
  entries: [
    { name: 'writing.style', status: 'resolved' as const, value: 'plain', candidates: [
      { sourceId: 'preset:preset-1', sourceKind: 'preset' as const, sourceLabel: 'New Preset', value: 'plain' },
    ] },
    { name: 'global.user.name', status: 'resolved' as const, value: 'Mio', candidates: [
      { sourceId: 'state.global', sourceKind: 'state' as const, sourceLabel: 'Global State', value: 'Mio' },
    ] },
    { name: 'computed.bot.name', status: 'resolved' as const, value: 'Bot', candidates: [
      { sourceId: 'builtin.computed', sourceKind: 'builtin' as const, sourceLabel: 'Computed', value: 'Bot' },
    ] },
    { name: 'user', status: 'resolved' as const, value: 'Mio', candidates: [
      { sourceId: 'builtin.aliases', sourceKind: 'builtin' as const, sourceLabel: 'Built-in alias', value: 'Mio' },
    ] },
  ],
  capturedAt: '2026-09-29T00:00:00Z',
}

describe('macro panel UI', () => {
  it('keeps macro save/delete non-submitting and disabled while busy, with danger deletion', () => {
    const html = renderToStaticMarkup(createElement(MacroEntryDetail, {
      title: 'Macro', name: 'name', t, busy: true, dirty: true,
      onSave: () => undefined, onDelete: () => undefined,
    }))
    const commands = [...html.matchAll(/<button\b[^>]*data-loom-ui-button=""[^>]*>/g)].map(match => match[0])
    expect(commands).toHaveLength(2)
    for (const command of commands) {
      expect(command).toContain('disabled=""')
      expect(command).toContain('type="button"')
    }
    expect(commands[0]).toContain('data-variant="danger"')
    const clean = renderToStaticMarkup(createElement(MacroEntryDetail, {
      title: 'Macro', name: 'name', t, dirty: false, onSave: () => undefined,
    }))
    expect(clean.match(/<button\b[^>]*data-loom-ui-button=""[^>]*>/)?.[0]).toContain('disabled=""')
  })

  it('shows search and preset icon in the authoring tree, with shared underlined candidate inputs', () => {
    const explorer = renderToStaticMarkup(createElement(MacroAuthoringExplorer, { controller }))
    const detail = renderToStaticMarkup(createElement(MacroAuthoringDetail, { controller }))
    expect(explorer).toContain('aria-label="搜索宏"')
    expect(explorer).toContain('writing.style')
    expect(explorer).toContain('lucide-bot')
    expect(detail).toContain('<legend>候选值</legend>')
    expect(detail.match(/data-loom-ui-text-input/g)).toHaveLength(2)
    expect(detail).not.toContain('<legend>文风</legend>')
  })

  it('keeps the inspection workbench in place while a selection is loading', () => {
    const html = renderToStaticMarkup(createElement(MacroInspectorPanel, {
      inspection, loading: true, selections: {}, onSelectSource: () => undefined, onRefresh: () => undefined, t,
    }))
    expect(html).toContain('macro-inspector-workbench')
    expect(html).toContain('writing.style')
    expect(html).toContain('<strong>user</strong>')
    expect(html).toContain('aria-expanded="true"')
    expect(html).not.toContain('global.user.name')
    expect(html).not.toContain('computed.bot.name')
    expect(html).not.toContain('正在加载检查')
  })

  it('offers authoring and current preview without the build tab', () => {
    const html = renderToStaticMarkup(createElement(StudioMacroPanel, {
      macroTargetKey: 'key', macroInspection: inspection, macroInspectionLoading: false,
      macroSelections: {}, sources: controller.sources, t,
      onSelectSource: () => undefined, onRefresh: () => undefined,
    }))
    expect(html).toContain('当前预览')
    expect(html).not.toContain('本次构建')
  })
})
