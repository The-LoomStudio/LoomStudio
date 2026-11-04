import { describe, expect, it } from 'vitest'
import { parseLoomScriptSource, serializeMarkdownTextRule, resolveTextTransformContributionRule } from '@loom-studio/shared/loom-scripts'
import { projectHistoryEntries, type TextTransformRuleEntry } from '@loom-studio/application-runtime'

function parse(body: string, extra = '') {
  return parseLoomScriptSource(`---\nid: example.rule\nname: 示例\nregex: '^(.*)$'\nregex_flags: s\n${extra}---\n${body}`)
}
function contribution(source: ReturnType<typeof parse>) {
  const item = source.contributions[0]!
  if (item.kind !== 'text-transform') throw new Error('Expected rule')
  return resolveTextTransformContributionRule(item)
}
const source = { kind: 'agent-session', sessionId: 'test' } as const
function project(text: string, draft: ReturnType<typeof contribution>, streaming = false) {
  const rule = { ...draft, id: 'rule', version: 1, owner: { kind: 'user-override' }, createdAt: '', updatedAt: '' } as TextTransformRuleEntry
  return projectHistoryEntries({ source, phase: 'display', streaming, rules: [rule], entries: [{ id: 'message', source, sequence: 1, role: 'assistant', text }] }).entries[0]!.text
}

describe('Markdown text rule source', () => {
  it('round trips stable Lore links without embedding their content', () => {
    const rule = contribution(parse('replacement', 'lore_refs:\n  - resourceId: lore-a\n    nodeId: entry-a\n'))
    expect(rule.loreRefs).toEqual([{ resourceId: 'lore-a', nodeId: 'entry-a' }])
    expect(contribution(parseLoomScriptSource(serializeMarkdownTextRule(rule)))).toEqual(rule)
  })

  it('round trips optional prompt descriptions without changing the replacement body', () => {
    const rule = contribution(parse('<div>$1</div>', 'description: |\n  输出 <Message>正文</Message>。\n  不要省略结束标签。\ndescription_anchor: "@chat.tools"\n'))
    expect(rule.description).toBe('输出 <Message>正文</Message>。\n不要省略结束标签。\n')
    expect(contribution(parseLoomScriptSource(serializeMarkdownTextRule(rule)))).toEqual(rule)
    expect(contribution(parse('')).description).toBeUndefined()
  })

  it('preserves the raw body including nested fences, comments, and CRLF without executing it', () => {
    const body = '\r\n```html\r\n<div>$1</div><script>/* comment */ throw new Error("never")</script>\r\n```\r\n  '
    const parsed = parse(body)
    expect(parsed.runtime).toBe('declarative')
    expect(contribution(parsed).effect).toEqual({ kind: 'replace', replacement: body })
    expect(contribution(parseLoomScriptSource(serializeMarkdownTextRule(contribution(parsed)))).effect).toEqual(contribution(parsed).effect)
  })
  it('distinguishes deletion from whitespace and rejects duplicate header keys', () => {
    expect(project('hello', contribution(parse('')))).toBe('')
    expect(project('hello', contribution(parse('  \n')))).toBe('  \n')
    expect(() => parse('', 'name: duplicate\n')).toThrow()
    expect(() => parseLoomScriptSource('---\nid: missing')).toThrow('closing delimiter')
  })
  it('honors first-match versus global flags', () => {
    const draft = contribution(parse('y'))
    draft.matcher = { kind: 'regex', pattern: 'x', flags: '' }
    expect(project('xx', draft)).toBe('yx')
    expect(project('xx', { ...draft, matcher: { ...draft.matcher, flags: 'g' } })).toBe('yy')
  })
  it('removes literal text only from referenced captures, not the template or unmatched text', () => {
    const draft = contribution(parse('<Image>$1</Image>/$&', "capture_remove: ['<Image>', '</Image>']\n"))
    draft.matcher = { kind: 'regex', pattern: '<Closeup>([\\s\\S]*?)</Closeup>', flags: 'g' }
    expect(project('before<Image>x</Image><Closeup><Image>inside</Image></Closeup>', draft))
      .toBe('before<Image>x</Image><Image>inside</Image>/<Closeup>inside</Closeup>')
  })
  it('runs opt-in rules against each raw streaming snapshot including incomplete captures', () => {
    const draft = contribution(parse('UPDATING:$1', 'streaming: true\n'))
    draft.matcher = { kind: 'regex', pattern: '<UpdateVariable(?:variable)?>(?!.*<\\/UpdateVariable(?:variable)?>)\\s*(.*)\\s*$', flags: 'gsi' }
    for (const text of ['<UpdateVariable>', '<UpdateVariable>one', '<UpdateVariable>one</Update']) {
      expect(project(text, draft, true)).toBe(`UPDATING:${text.slice('<UpdateVariable>'.length)}`)
    }
    const completed = '<UpdateVariable>one</UpdateVariable>'
    expect(project(completed, draft, true)).toBe(completed)
    expect(project('<UpdateVariable>one', { ...draft, streaming: false }, true)).toBe('<UpdateVariable>one')
    expect(project('<UpdateVariable>one', { ...draft, streaming: false })).toBe('UPDATING:one')
  })
})
