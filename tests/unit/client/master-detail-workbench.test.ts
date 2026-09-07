import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MasterDetailWorkbench } from '../../../apps/studio-client/src/shared/ui/master-detail-workbench/master-detail-workbench.js'

describe('MasterDetailWorkbench', () => {
  it('renders both master and detail panes on server / initial render', () => {
    const html = renderToStaticMarkup(
      createElement(
        MasterDetailWorkbench,
        {
          master: createElement('div', { id: 'test-master' }, 'Master List'),
          dataComponent: 'test-workbench',
        },
        createElement('div', { id: 'test-detail' }, 'Detail Content'),
      ),
    )

    expect(html).toContain('id="test-master"')
    expect(html).toContain('id="test-detail"')
    expect(html).toContain('data-loom-component="test-workbench"')
  })
})
