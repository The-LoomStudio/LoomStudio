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

  it('supports Unicode/Chinese macros and cascade scope lookup without prefixes', () => {
    const variables = createVariableRenderContext({
      global: {
        user: { name: '开拓者', description: '沉默寡言的旅人，携带着神秘星核' },
        WritingStyle: '轻小说细腻文风',
        共同属性: '全局值',
      },
      timeline: {
        爱丽丝好感第一阶段语料: '红着脸低下头，小声地回应着。',
        共同属性: '世界线局部覆盖值',
      },
    })

    const rendered = renderVariableMacros(
      '【{{User}}】({{user.description}}) 风格:{{WritingStyle}} 语料:{{爱丽丝好感第一阶段语料}} 覆盖:{{共同属性}}',
      variables,
    )

    expect(rendered).toBe('【开拓者】(沉默寡言的旅人，携带着神秘星核) 风格:轻小说细腻文风 语料:红着脸低下头，小声地回应着。 覆盖:世界线局部覆盖值')
    expect(variables.trace.reads).toEqual([
      { requestedPath: 'User', resolvedPath: 'global.user.name', source: 'global' },
      { requestedPath: 'user.description', resolvedPath: 'global.user.description', source: 'global' },
      { requestedPath: 'WritingStyle', resolvedPath: 'WritingStyle', source: 'global' },
      { requestedPath: '爱丽丝好感第一阶段语料', resolvedPath: '爱丽丝好感第一阶段语料', source: 'timeline' },
      { requestedPath: '共同属性', resolvedPath: '共同属性', source: 'timeline' },
    ])
  })

  it('supports lowercase {{user}}, {{char}}, and {{bot}} aliases', () => {
    const variables = createVariableRenderContext({
      global: { user: { name: '晴人' } },
      computed: {
        char: { name: '柚木凛' },
        bot: { name: '柚木凛' },
      },
    })
    const rendered = renderVariableMacros('你好 {{user}}，我是 {{char}} 也是 {{bot}}', variables)
    expect(rendered).toBe('你好 晴人，我是 柚木凛 也是 柚木凛')
  })

  it('supports case-insensitive custom variables in prompt expansion', () => {
    const variables = createVariableRenderContext({
      global: {
        WritingStyle: '轻小说细腻风',
        Stats: { Level: 50 },
      },
      timeline: {
        HP: 100,
      },
    })
    const rendered = renderVariableMacros(
      '风格: {{writingstyle}} / 血量: {{hp}} / 等级: {{stats.level}}',
      variables,
    )
    expect(rendered).toBe('风格: 轻小说细腻风 / 血量: 100 / 等级: 50')
  })
})
