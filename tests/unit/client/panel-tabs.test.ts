import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PanelTabs, type PanelTabItem } from '../../../apps/studio-client/src/shared/ui/panel-tabs/index.js'

describe('PanelTabs component', () => {
  const items: PanelTabItem<'a' | 'b' | 'c'>[] = [
    { id: 'a', label: 'Tab A' },
    { id: 'b', label: 'Tab B' },
    { id: 'c', label: 'Tab C', disabled: true },
  ]

  it('renders tablist with tabs having aria-selected and disabled attributes', () => {
    const html = renderToStaticMarkup(
      createElement(PanelTabs, {
        activeId: 'a',
        ariaLabel: 'Test tabs',
        items,
        onChange: () => undefined,
      }),
    )

    expect(html).toContain('role="tablist"')
    expect(html).toContain('aria-label="Test tabs"')
    expect(html).toContain('Tab A')
    expect(html).toContain('Tab B')
    expect(html).toContain('Tab C')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('aria-selected="false"')
    expect(html).toContain('disabled=""')
  })

  it('renders compact and centered variants', () => {
    const html = renderToStaticMarkup(
      createElement(PanelTabs, {
        activeId: 'b',
        align: 'center',
        items,
        size: 'compact',
        onChange: () => undefined,
      }),
    )

    expect(html).toContain('alignCenter')
    expect(html).toContain('compact')
  })
})
