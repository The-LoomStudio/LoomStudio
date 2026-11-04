import { highlightCode } from '../../../apps/studio-client/src/shared/ui/markdown-content/code-highlight.js'
import { createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownContent } from '../../../apps/studio-client/src/shared/ui/markdown-content/markdown-content.js'
import { prepareLoomMarkdown, readLoomToken } from '../../../apps/studio-client/src/shared/ui/markdown-content/markdown-content-model.js'

const codeBlockLabels = { copied: 'Copied', copy: 'Copy', copyFailed: 'Failed', disableWrap: 'Unwrap', enableWrap: 'Wrap' }

describe('Loom Markdown preview tokens', () => {
  it.each([
    ['| A | B |\n| --- | --- |\n| 1 | 2 |', '<table>'],
    ['Heading\n=======', '<h1>'],
    ['- first\n- second', '<ul>'],
    ['```text\nfirst\nsecond\n```', '<pre>'],
  ])('preserves Markdown block structure for %s', (value, tag) => {
    expect(renderToStaticMarkup(createElement(MarkdownContent, { value, codeBlockLabels }))).toContain(tag)
  })

  it('preserves soft line breaks in the parsed paragraph', () => {
    expect(renderToStaticMarkup(createElement(MarkdownContent, { value: 'first\nsecond', codeBlockLabels }))).toContain('<p>first\nsecond</p>')
  })
  it('turns macros and resource paths into semantic links', () => {
    const rendered = prepareLoomMarkdown('读取 @assets/maps/城区地图.png，并检查 {{player.location}}。')

    expect(rendered).toContain('](loom-asset:')
    expect(rendered).toContain('](loom-macro:')
  })

  it('does not transform fenced or inline code', () => {
    expect(prepareLoomMarkdown('`@assets/a.png`\n```yaml\nref: @assets/a.png\n```')).toBe(
      '`@assets/a.png`\n```yaml\nref: @assets/a.png\n```',
    )
  })

  it.each([
    '````text\n```\n{{player.name}} @assets/a.png\n```\n````',
    '~~~~text\n~~~\n{% player.name %} @assets/a.png\n~~~\n~~~~',
    '``code ` {{player.name}} @assets/a.png``',
    '``code\n` {{player.name}} @assets/a.png``',
    '```text\n{{player.name}} @assets/a.png',
    '    {{player.name}} @assets/a.png',
  ])('preserves Markdown code delimiters and contents in %s', value => {
    expect(prepareLoomMarkdown(value)).toBe(value)
  })

  it('still transforms tokens after a long closing fence and beside inline code', () => {
    const code = '````text\n```\n{{inside}}\n```\n````'
    const value = prepareLoomMarkdown(`${code}\n{{outside}} and \`\`{{literal}} \`\` @assets/a.png`)
    expect(value.startsWith(`${code}\n`)).toBe(true)
    expect(value).toContain('``{{literal}} ``')
    expect(value).toContain('[{{outside}}](loom-macro:')
    expect(value).toContain('[@assets/a.png](loom-asset:')
  })

  it('rejects malformed encoded tokens', () => {
    expect(readLoomToken('loom-asset:%E0%A4%A', 'loom-asset:')).toBeUndefined()
  })

  it('highlights supported fenced-code languages and leaves unknown languages plain', () => {
    expect(highlightCode('const answer = 42', 'js').some(isValidElement)).toBe(true)
    expect(highlightCode('plain text', 'unknown')).toEqual(['plain text'])
  })

  it('classifies YAML keys and scalar values like equivalent JSON data', () => {
    const highlighted = highlightCode('scene:\n  floor: 11\n  weather: rain\n  enabled: true\n  empty: null', 'yaml')

    expect(readHighlightedTokens(highlighted)).toMatchObject({
      scene: 'tok-propertyName tok-definition',
      floor: 'tok-propertyName tok-definition',
      '11': 'tok-number',
      weather: 'tok-propertyName tok-definition',
      rain: 'tok-string',
      enabled: 'tok-propertyName tok-definition',
      true: 'tok-constant',
      empty: 'tok-propertyName tok-definition',
      null: 'tok-constant',
    })
  })

  it('distinguishes JSON property names from string values', () => {
    const highlighted = highlightCode('{"name": "loom-studio", "private": true}', 'json')

    expect(readHighlightedTokens(highlighted)).toMatchObject({
      '"name"': 'tok-propertyName',
      '"loom-studio"': 'tok-string',
      '"private"': 'tok-propertyName',
    })
  })
})

function readHighlightedTokens(parts: ReactNode[]) {
  return Object.fromEntries(parts.flatMap(part => {
    if (!isValidElement<{ className?: string; children?: ReactNode }>(part)) return []
    return [[String(part.props.children), part.props.className]]
  }))
}
