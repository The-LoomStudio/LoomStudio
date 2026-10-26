// @vitest-environment happy-dom
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PanelTabs, type PanelTabItem } from '../../../apps/studio-client/src/shared/ui/panel-tabs/index.js'
import { Tabs } from '@loom-studio/ui'

describe('PanelTabs component', () => {
  let container: HTMLDivElement | null = null

  afterEach(() => {
    if (container) {
      container.remove()
      container = null
    }
  })

  const items: PanelTabItem<'a' | 'b' | 'c'>[] = [
    { id: 'a', label: 'Tab A' },
    { id: 'b', label: 'Tab B' },
    { id: 'c', label: 'Tab C', disabled: true },
  ]

  it('renders tablist with tabs having aria-selected and disabled attributes', () => {
    const html = renderToStaticMarkup(
      React.createElement(PanelTabs, {
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
    expect(html).toContain('data-loom-ui-tabs-indicator')
  })

  it('renders compact and centered variants', () => {
    const html = renderToStaticMarkup(
      React.createElement(PanelTabs, {
        activeId: 'b',
        align: 'center',
        items,
        size: 'compact',
        onChange: () => undefined,
      }),
    )

    expect(html).toContain('alignCenter')
    expect(html).toContain('compact')
    expect(html).toContain('data-size="compact"')
    expect(html).toContain('data-align="center"')
  })

  it('interactively updates active tab and invokes onChange callback', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    const handleChange = vi.fn()
    flushSync(() => {
      root.render(
        React.createElement(Tabs<'a' | 'b' | 'c'>, {
          activeId: 'a',
          items,
          onChange: handleChange,
        }),
      )
    })

    const buttons = container.querySelectorAll<HTMLButtonElement>('button')
    expect(buttons).toHaveLength(3)

    // 点击第二个 Tab
    buttons[1]!.click()
    expect(handleChange).toHaveBeenCalledWith('b')

    // 点击被禁用的第三个 Tab，不触发回调
    handleChange.mockClear()
    buttons[2]!.click()
    expect(handleChange).not.toHaveBeenCalled()
  })

  it('handles arrow key navigation and wraps around enabled tabs', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    let currentActive: 'a' | 'b' | 'c' = 'a'
    const handleChange = vi.fn((id: 'a' | 'b' | 'c') => {
      currentActive = id
    })

    flushSync(() => {
      root.render(
        React.createElement(Tabs<'a' | 'b' | 'c'>, {
          activeId: currentActive,
          items,
          onChange: handleChange,
        }),
      )
    })

    const buttons = container.querySelectorAll<HTMLButtonElement>('button')
    // 在第一个 Tab 上按 ArrowRight
    buttons[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(handleChange).toHaveBeenCalledWith('b')

    // 重新渲染为 activeId = 'b'
    flushSync(() => {
      root.render(
        React.createElement(Tabs<'a' | 'b' | 'c'>, {
          activeId: 'b',
          items,
          onChange: handleChange,
        }),
      )
    })

    // 在第二个 Tab 上按 ArrowRight，由于 'c' 是 disabled，应该跳过并循环回到 'a'
    handleChange.mockClear()
    buttons[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(handleChange).toHaveBeenCalledWith('a')
  })
})
