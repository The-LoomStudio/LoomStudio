import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StateVariablesPanel } from '../../../apps/studio-client/src/features/state-variables/ui/state-variables-panel.js'

describe('StateVariablesPanel', () => {
  it('renders Global, Timeline, Definition, and Card configuration surfaces', () => {
    const html = renderToStaticMarkup(createElement(StateVariablesPanel, {
      api: {
        get: async () => { throw new Error('not called during SSR') },
        apply: async () => { throw new Error('not called during SSR') },
        listDefinitions: async () => ({ definitions: [] }),
        getDefinition: async () => { throw new Error('not called during SSR') },
        upsertDefinition: async () => { throw new Error('not called during SSR') },
        deleteDefinition: async () => { throw new Error('not called during SSR') },
      },
      timelineTarget: { scope: 'timeline', timelineId: 'timeline-1', branchId: 'branch-2' },
      onUpdateCardConfig: async () => undefined,
    }))

    expect(html).toContain('Workspace Global State')
    expect(html).toContain('当前 Timeline / Branch State')
    expect(html).toContain('共享 State Definition')
    expect(html).toContain('当前 Card Template / Binding')
    expect(html).toContain('timeline-1')
    expect(html).toContain('branch-2')
  })
})
