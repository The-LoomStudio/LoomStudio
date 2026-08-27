import {
  createVariableRenderContext,
  renderVariableMacros,
} from '@loom-studio/application-runtime'
import { describe, expect, it } from 'vitest'

describe('variable macro renderer', () => {
  it('resolves aliases and canonical global, timeline, and computed paths once', () => {
    const variables = createVariableRenderContext({
      global: { user: { name: 'Mio' }, writingStyle: 'concise' },
      timeline: { entities: { alice: { attitude: 'warm' } } },
      computed: { global: { time: { now: '2026-08-25T02:00:00.000Z' } } },
    })
    const rendered = renderVariableMacros(
      '{{User}} / {{global.user.name}} / {{global.writingStyle}} / {{timeline.entities.alice.attitude}} / {{global.time.now}}',
      variables,
    )

    expect(rendered).toBe('Mio / Mio / concise / warm / 2026-08-25T02:00:00.000Z')
    expect(variables.trace.reads).toEqual([
      { requestedPath: 'User', resolvedPath: 'global.user.name', source: 'global' },
      { requestedPath: 'global.user.name', resolvedPath: 'global.user.name', source: 'global' },
      { requestedPath: 'global.writingStyle', resolvedPath: 'global.writingStyle', source: 'global' },
      { requestedPath: 'timeline.entities.alice.attitude', resolvedPath: 'timeline.entities.alice.attitude', source: 'timeline' },
      { requestedPath: 'global.time.now', resolvedPath: 'global.time.now', source: 'computed' },
    ])
  })

  it('keeps missing and non-scalar macros visible with diagnostics', () => {
    const variables = createVariableRenderContext({
      global: { profile: { name: 'Mio' } },
    })
    const rendered = renderVariableMacros(
      'Missing {{global.missing}} and object {{global.profile}}.',
      variables,
    )

    expect(rendered).toBe('Missing {{global.missing}} and object {{global.profile}}.')
    expect(variables.trace.diagnostics).toEqual([
      { severity: 'warning', code: 'variable.path_missing', path: 'global.missing' },
      { severity: 'warning', code: 'variable.value_not_scalar', path: 'global.profile' },
    ])
  })

  it('does not recursively expand macro-looking variable values', () => {
    const variables = createVariableRenderContext({
      global: {
        first: '{{global.second}}',
        second: 'expanded only on another render pass',
      },
    })
    expect(renderVariableMacros('{{global.first}}', variables)).toBe('{{global.second}}')
  })
})
