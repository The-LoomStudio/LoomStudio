import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MasterDetailWorkbench } from '../../../apps/studio-client/src/shared/ui/master-detail-workbench/master-detail-workbench.js'

describe('MasterDetailWorkbench', () => {
  it('starts in mobile single-pane layout instead of animating from desktop columns on tab mount', () => {
    vi.stubGlobal('window', { innerWidth: 390 })
    try {
      const html = renderToStaticMarkup(createElement(MasterDetailWorkbench, {
        master: '目录', children: '详情', mobilePane: 'master',
      }))
      expect(html).toContain('data-single-pane="true"')
      expect(html).toContain('data-pane="master"')
    } finally { vi.unstubAllGlobals() }
  })

  it('includes both panes and marks the hidden pane inert in drilldown with and without selection', () => {
    const markup = (hasSelection: boolean) => renderToStaticMarkup(createElement(MasterDetailWorkbench, {
      master: createElement('div', { id: 'directory' }, 'Directory'),
      children: createElement('textarea', { id: 'draft', defaultValue: 'Unsaved draft' }),
      drilldown: true, mobilePane: 'detail', hasSelection,
    }))
    for (const hasSelection of [true, false]) {
      const html = markup(hasSelection)
      expect(html).toContain('id="directory"')
      expect(html).toContain('id="draft"')
      expect(html).toContain('Unsaved draft')
      expect(html).toContain(`data-pane="${hasSelection ? 'detail' : 'master'}"`)
      expect(html).toContain(hasSelection
        ? 'data-loom-slot="master" inert=""'
        : 'data-loom-slot="detail" inert=""')
      expect(html).not.toContain('role="separator"')
    }
  })

  it('renders both master and detail panes on server / initial render', () => {
    const html = renderToStaticMarkup(
      createElement(
        MasterDetailWorkbench,
        {
          master: createElement('div', { id: 'test-master' }, 'Master List'),
          dataComponent: 'test-workbench',
          children: createElement('div', { id: 'test-detail' }, 'Detail Content'),
        },
      ),
    )

    expect(html).toContain('id="test-master"')
    expect(html).toContain('id="test-detail"')
    expect(html).toContain('data-loom-component="test-workbench"')
  })
})
