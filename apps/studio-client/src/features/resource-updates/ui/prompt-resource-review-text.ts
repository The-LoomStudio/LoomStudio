import type { PromptResourceArtifact } from '../../../entities/workspace.js'

/** Readable package content in tree order; origin, timestamps and local IDs are not content. */
export function formatPromptResourceForReview(artifact: PromptResourceArtifact | undefined): string | null {
  if (!artifact) return null
  const lines: string[] = []
  function visit(node: PromptResourceArtifact['rootNode'], depth: number, ordinal: string) {
    const role = node.capabilities?.roleHint
    lines.push(`${'  '.repeat(depth)}${ordinal} ${node.label}${role ? ` · ${role}` : ''}${node.enabled === false ? ' · 已关闭' : ''}`)
    if (node.body) lines.push(node.body)
    for (const [index, child] of (node.children ?? []).entries()) visit(child, depth + 1, `${ordinal}.${index + 1}`)
    if (node.children?.length || node.body) lines.push('')
  }
  visit(artifact.rootNode, 0, '1')
  if (artifact.macros && Object.keys(artifact.macros).length) {
    lines.push('宏定义')
    for (const [name, value] of Object.entries(artifact.macros)) lines.push(`${name} = ${value}`)
  }
  if (artifact.macroOptions && Object.keys(artifact.macroOptions).length) {
    lines.push('', '宏选项', JSON.stringify(artifact.macroOptions, null, 2))
  }
  return lines.join('\n').trim()
}
