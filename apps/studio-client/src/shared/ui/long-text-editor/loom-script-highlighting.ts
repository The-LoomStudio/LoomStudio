import { StateField, type EditorState } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'

const fieldHelp: Record<string, string> = {
  format: '脚本文件格式版本', id: '作者指定的稳定标识', name: '脚本显示名称', version: '作者版本号',
  runtime: '代码运行环境；纯声明规则无需启动代码', capability: '脚本申请的宿主能力',
  require: '外部代码依赖', tag: '用于搜索和分类的作者标签',
  setting: '向用户开放的配置项：平台保存用户值，不修改这里的默认值',
  contribution: '脚本向平台注册的渲染器、文本规则或提取器',
  text: '多行文本块，可由规则的替换内容引用',
}

/** Metadata remains a JavaScript comment, with an additional readable declaration layer. */
function metadataDecorations(state: EditorState): DecorationSet {
  if (state.doc.line(1).text !== '// ==LoomScript==') return Decoration.none
  const marks: ReturnType<Decoration['range']>[] = []
  let textBlockEnd: string | undefined
  for (let number = 1; number <= state.doc.lines; number++) {
    const line = state.doc.line(number)
    if (line.text === '// ==LoomScript==' || line.text === '// ==/LoomScript==') {
      marks.push(Decoration.mark({ class: 'cm-loom-metadata-marker' }).range(line.from, line.to))
      if (number > 1) break
      continue
    }
    if (!line.text.trim()) continue
    if (!line.text.startsWith('//')) break
    if (textBlockEnd) {
      if (line.text === textBlockEnd) textBlockEnd = undefined
      if (line.length > 2) marks.push(Decoration.mark({ class: 'cm-loom-metadata-string' }).range(line.from + 2, line.to))
      continue
    }
    const declaration = /^\/\/\s+(@[a-z]+)\s+/.exec(line.text)
    const contentStart = declaration ? declaration[0].length : /^\/\/\s*/.exec(line.text)![0].length
    if (declaration) {
      const name = declaration[1]!
      const from = line.from + line.text.indexOf(name)
      marks.push(Decoration.mark({ class: 'cm-loom-metadata-field', attributes: { title: fieldHelp[name.slice(1)] ?? 'Metadata 字段' } }).range(from, from + name.length))
      if (contentStart < line.length) marks.push(Decoration.mark({ class: 'cm-loom-metadata-value' }).range(line.from + contentStart, line.to))
    }
    // JSON values may span several commented lines. Highlight only tokens, without interpreting code.
    const content = line.text.slice(contentStart)
    if (declaration?.[1] === '@text') {
      const end = /<<([A-Za-z0-9_]+)$/.exec(content)
      if (end) textBlockEnd = `// ${end[1]}`
    }
    if (!declaration || declaration[1] === '@setting' || declaration[1] === '@contribution') {
      for (const token of content.matchAll(/"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?\b/g)) {
        const from = line.from + contentStart + token.index!
        const after = content.slice(token.index! + token[0].length)
        const kind = token[0].startsWith('"') ? (/^\s*:/.test(after) ? 'property' : 'string') : (/^(true|false|null)$/.test(token[0]) ? 'constant' : 'number')
        marks.push(Decoration.mark({ class: `cm-loom-metadata-${kind}` }).range(from, from + token[0].length))
      }
    }
  }
  return Decoration.set(marks, true)
}

const metadataField = StateField.define<DecorationSet>({
  create: metadataDecorations,
  update: (decorations, transaction) => transaction.docChanged ? metadataDecorations(transaction.state) : decorations,
  provide: field => EditorView.decorations.from(field),
})

export const loomScriptMetadataHighlighting = [metadataField, EditorView.theme({
  // JavaScript nests its comment token inside our marks. Inherit the declaration color
  // without overriding nested property/string marks or comments outside the header.
  '[class*=cm-loom-metadata-] > span:not([class*=cm-loom-metadata-])': { color: 'inherit' },
  '.cm-loom-metadata-marker': { color: 'var(--loom-color-syntax-meta)', fontWeight: '600' },
  '.cm-loom-metadata-field': { color: 'var(--loom-color-syntax-keyword)', fontWeight: '600' },
  '.cm-loom-metadata-value': { color: 'var(--loom-color-text)' },
  '.cm-loom-metadata-property': { color: 'var(--loom-color-syntax-property)' },
  '.cm-loom-metadata-string': { color: 'var(--loom-color-syntax-string)' },
  '.cm-loom-metadata-number': { color: 'var(--loom-color-syntax-number)' },
  '.cm-loom-metadata-constant': { color: 'var(--loom-color-syntax-constant)' },
})]
