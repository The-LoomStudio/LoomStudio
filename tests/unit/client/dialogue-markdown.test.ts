import { describe, expect, it } from 'vitest'
import { remarkLoomDialogue, splitDialogueText } from '../../../apps/studio-client/src/shared/ui/markdown-content/dialogue-markdown.js'

describe('dialogue markdown', () => {
  it('recognizes common dialogue delimiters', () => {
    const nodes = splitDialogueText('他说“晚安”，然后补充「またね」。')
    expect(nodes.filter(node => node.type === 'link').map(node => node.url)).toEqual([
      `loom-dialogue:${encodeURIComponent('“晚安”')}`,
      `loom-dialogue:${encodeURIComponent('「またね」')}`,
    ])
  })

  it('recognizes straight and Japanese double corner quotes', () => {
    expect(splitDialogueText('"Hello" 『さようなら』').filter(node => node.type === 'link')).toHaveLength(2)
  })

  it('does not decorate code or existing links', () => {
    const tree = {
      type: 'root',
      children: [
        { type: 'code', value: '"code"' },
        { type: 'link', url: 'https://example.com', children: [{ type: 'text', value: '“link”' }] },
      ],
    }
    remarkLoomDialogue()(tree)
    expect(tree.children).toEqual([
      { type: 'code', value: '"code"' },
      { type: 'link', url: 'https://example.com', children: [{ type: 'text', value: '“link”' }] },
    ])
  })
})
