import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ExtensionSettingsForm } from '../../../apps/studio-client/src/features/extension-renderers/ui/extension-settings-form.js'

describe('ExtensionSettingsForm', () => {
  it('renders the supported Host controls without a page-level save action', () => {
    const html = renderToStaticMarkup(createElement(ExtensionSettingsForm, {
      api: {
        getConfig: vi.fn(),
        listConfigs: vi.fn(),
        upsertConfig: vi.fn(),
      },
      configRevision: 0,
      packageId: 'example.settings',
      scopeContext: {},
      settings: [
        { id: 'enabled', type: 'boolean', label: 'Enabled', default: true },
        { id: 'name', type: 'text', label: 'Name', default: '' },
        { id: 'notes', type: 'multiline', label: 'Notes', default: '' },
        { id: 'count', type: 'number', label: 'Count', default: 1 },
        { id: 'mode', type: 'select', label: 'Mode', default: 'quiet', options: [{ value: 'quiet', label: 'Quiet' }] },
        { id: 'level', type: 'range', label: 'Level', default: 5, min: 0, max: 10 },
      ],
      t: key => key,
    }))

    expect(html).toContain('type="checkbox"')
    expect(html).toContain('type="text"')
    expect(html).toContain('<textarea')
    expect(html).toContain('type="number"')
    expect(html).toContain('<select')
    expect(html).toContain('type="range"')
    expect(html).not.toContain('<button')
  })
})
