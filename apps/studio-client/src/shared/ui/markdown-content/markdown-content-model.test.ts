import { isValidElement } from 'react'
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
})
