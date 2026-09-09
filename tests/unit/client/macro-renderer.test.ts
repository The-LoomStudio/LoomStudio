import { describe, expect, it } from 'vitest'
import { createVariableRenderContext, renderVariableMacros } from '@loom-studio/shared'
import { renderTemplateMacros } from '../../../apps/studio-client/src/features/state-variables/model/macro-renderer.js'

describe('renderTemplateMacros', () => {
  it('uses the build snapshot without recomputing values or recursively expanding provider text', () => {
    const context = createVariableRenderContext({
      global: { user: { name: 'Snapshot User' }, object: { name: 'not a scalar' } },
      timeline: { hp: 17 },
      computed: { 'alice.tone': '{{user}} stays guarded' },
    })
    const template = '{{user}} / {{alice.tone}} / {{hp}} / {{object}} / {{missing}}'
    expect(renderTemplateMacros(template, { snapshot: context.snapshot, card: { userName: 'Changed' } }))
      .toBe(renderVariableMacros(template, context))
    expect(renderTemplateMacros(template, { snapshot: context.snapshot }))
      .toBe('Snapshot User / {{user}} stays guarded / 17 / {{object}} / {{missing}}')
  })

  it('renders {{User}} with default fallback when no state is provided', () => {
    const text = 'Hello {{User}}, welcome to Loom!'
    expect(renderTemplateMacros(text)).toBe('Hello User, welcome to Loom!')
  })

  it('renders {{User}} from card userName fallback', () => {
    const text = 'Hello {{User}}!'
    expect(renderTemplateMacros(text, { card: { userName: 'Alice' } })).toBe('Hello Alice!')
  })

  it('renders {{User}} and {{user.name}} from global state priority', () => {
    const text = 'Hello {{User}} (aka {{user.name}}), role: {{user.description}}'
    const context = {
      global: {
        user: {
          name: 'shiyue',
          description: 'Commander',
        },
      },
      card: { userName: 'Fallback' },
    }
    expect(renderTemplateMacros(text, context)).toBe('Hello shiyue (aka shiyue), role: Commander')
  })

  it('renders {{char}} from card name', () => {
    const text = 'I am {{char}}.'
    expect(renderTemplateMacros(text, { card: { name: 'Bob' } })).toBe('I am Bob.')
  })

  it('renders unicode and Chinese macro variables with cascade resolution', () => {
    const text = '语料: {{爱丽丝好感第一阶段语料}}, 写作风格: {{WritingStyle}}'
    const context = {
      timeline: {
        爱丽丝好感第一阶段语料: '“你今天来得真早呢……”',
      },
      global: {
        WritingStyle: '轻小说细腻风',
      },
    }
    expect(renderTemplateMacros(text, context)).toBe(
      '语料: “你今天来得真早呢……”, 写作风格: 轻小说细腻风',
    )
  })

  it('supports explicit global. and timeline. path prefixes', () => {
    const text = 'Global: {{global.user.name}}, Timeline: {{timeline.hp}}'
    const context = {
      global: { user: { name: 'Hero' } },
      timeline: { hp: 100 },
    }
    expect(renderTemplateMacros(text, context)).toBe('Global: Hero, Timeline: 100')
  })

  it('renders lowercase {{user}} and {{char}} regardless of casing', () => {
    const text = '秋山蓝看着刚从自己房间出来的 {{user}}。{{user}}刚整理完资料。啊，{{USER}}！我是{{char}}，也就是{{bot}}。'
    const context = {
      global: {
        user: { name: 'shiyue' },
      },
      card: { name: '爱丽丝' },
    }
    expect(renderTemplateMacros(text, context)).toBe(
      '秋山蓝看着刚从自己房间出来的 shiyue。shiyue刚整理完资料。啊，shiyue！我是爱丽丝，也就是爱丽丝。',
    )
  })

  it('resolves custom variables case-insensitively', () => {
    const text = '风格: {{writingstyle}} / 生命: {{hp}} / 嵌套: {{player.stats.level}}'
    const context = {
      global: {
        WritingStyle: '轻小说细腻风',
        Player: {
          Stats: {
            Level: 99,
          },
        },
      },
      timeline: {
        HP: 100,
      },
    }
    expect(renderTemplateMacros(text, context)).toBe('风格: 轻小说细腻风 / 生命: 100 / 嵌套: 99')
  })

  it('preserves unknown tokens and skips rendering when template has no macros', () => {
    const plain = 'Normal text without macros'
    expect(renderTemplateMacros(plain)).toBe(plain)

    const unknown = 'Hello {{NonExistentVariable}}'
    expect(renderTemplateMacros(unknown)).toBe(unknown)
  })
})
