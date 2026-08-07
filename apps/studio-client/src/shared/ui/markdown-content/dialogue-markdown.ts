type MarkdownNode = {
  children?: MarkdownNode[]
  type: string
  url?: string
  value?: string
}

const DIALOGUE_PATTERN = /"[^"\n]+"|“[^”\n]+”|「[^」\n]+」|『[^』\n]+』/gu
const BLOCKED_NODE_TYPES = new Set(['code', 'inlineCode', 'link'])

export function remarkLoomDialogue() {
  return (tree: MarkdownNode) => transformDialogueNodes(tree)
}

export function splitDialogueText(value: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = []
  let cursor = 0

  for (const match of value.matchAll(DIALOGUE_PATTERN)) {
    const index = match.index
    if (index > cursor) nodes.push({ type: 'text', value: value.slice(cursor, index) })
    nodes.push({
      type: 'link',
      url: `loom-dialogue:${encodeURIComponent(match[0])}`,
      children: [{ type: 'text', value: match[0] }],
    })
    cursor = index + match[0].length
  }

  if (cursor < value.length) nodes.push({ type: 'text', value: value.slice(cursor) })
  return nodes.length === 0 ? [{ type: 'text', value }] : nodes
}

function transformDialogueNodes(node: MarkdownNode) {
  if (!node.children || BLOCKED_NODE_TYPES.has(node.type)) return

  node.children = node.children.flatMap(child => {
    if (child.type === 'text' && child.value) return splitDialogueText(child.value)
    transformDialogueNodes(child)
    return child
  })
}
