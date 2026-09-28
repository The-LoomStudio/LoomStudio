import type { ToolResult } from './tool-registry.js'

export function renderToolResult(result: Pick<ToolResult, 'content' | 'error' | 'status'>): string {
  const content = result.content
    .map(part => part.type === 'text' ? part.text
      : part.type === 'json' ? JSON.stringify(part.value) : `[artifact:${part.artifactId}]`)
    .join('\n')
  return content || result.error?.message || result.status
}
