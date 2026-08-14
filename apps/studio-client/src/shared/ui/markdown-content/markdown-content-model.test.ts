import { isValidElement, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { highlightCode } from './markdown-content.js'
import { prepareLoomMarkdown, readLoomToken } from './markdown-content-model.js'

describe('Loom Markdown preview tokens', () => {
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
