import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { canRenderPanelHeaderContribution } from '../../../apps/studio-client/src/pages/studio/studio-window-header-context.js'
import { StudioWindowHeader } from '../../../apps/studio-client/src/pages/studio/studio-window-header.js'

describe('studio window header contributions', () => {
  const target = {} as HTMLElement

  it('renders only the active panel contribution into an available target', () => {
    expect(canRenderPanelHeaderContribution('play', 'play', target)).toBe(true)
    expect(canRenderPanelHeaderContribution('resource', 'play', target)).toBe(false)
    expect(canRenderPanelHeaderContribution(null, 'play', target)).toBe(false)
    expect(canRenderPanelHeaderContribution('play', 'play', null)).toBe(false)
  })

  it('renders the registered default title when a panel has no main contribution', () => {
    const html = renderToStaticMarkup(createElement(StudioWindowHeader, {
      activePanel: 'model',
      actionsTargetRef: () => {},
      assetWorkspaceId: 'workspace',
      onPanelHistory: () => {},
      t: key => key,
    }))

    expect(html).toContain('rail.model')
    expect(html).toContain('data-loom-component="window-header"')
  })
})
