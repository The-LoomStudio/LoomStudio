import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import type { Root, Element, RootContent } from 'hast'
import type { PluggableList } from 'unified'

const safeTags = [...(defaultSchema.tagNames ?? []), 'details', 'summary', 'small']
const styles: Record<string, RegExp> = {
  color: /^(#[\da-f]{3,8}|[a-z]+)$/i,
  'background-color': /^(#[\da-f]{3,8}|[a-z]+)$/i,
  'font-size': /^(\d{1,3}(\.\d+)?(px|em|rem|%)|small|smaller|medium|large|larger)$/,
  'font-weight': /^(normal|bold|[1-9]00)$/,
  'font-style': /^(normal|italic|oblique)$/,
  'text-align': /^(left|right|center|start|end)$/,
  'white-space': /^(normal|pre|pre-wrap|pre-line|break-spaces)$/,
  'text-decoration': /^(none|underline|line-through)$/,
}

function constrainHtml() {
  return (tree: Root, file: { value: unknown }) => {
    function visit(parent: Root | Element) {
      parent.children = parent.children.map((node): RootContent => {
        if (node.type !== 'element') return node
        if (!safeTags.includes(node.tagName) && !['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'link', 'meta'].includes(node.tagName)) {
          const start = node.position?.start.offset
          const end = node.position?.end.offset
          return { type: 'text', value: start !== undefined && end !== undefined
            ? String(file.value).slice(start, end)
            : `<${node.tagName}>` }
        }
        if (typeof node.properties.style === 'string') {
          node.properties.style = node.properties.style.split(';').flatMap(declaration => {
            const [name, value, ...rest] = declaration.split(':').map(part => part.trim())
            return name && value && rest.length === 0 && styles[name]?.test(value) ? [`${name}:${value}`] : []
          }).join(';')
        }
        visit(node)
        return node
      }) as typeof parent.children
    }
    visit(tree)
  }
}

export const safeHtmlPlugins: PluggableList = [
  rehypeRaw,
  constrainHtml,
  [rehypeSanitize, {
    ...defaultSchema,
    tagNames: safeTags,
    attributes: { ...defaultSchema.attributes, '*': [...(defaultSchema.attributes?.['*'] ?? []), 'style'], details: ['open'] },
  }],
]
