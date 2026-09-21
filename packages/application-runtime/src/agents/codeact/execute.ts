import type { ToolExecutionContext, ToolResult } from '../tool-registry.js'
import { createCodeActContext } from './context.js'
import { runCodeActSandbox } from './sandbox.js'
import { codeActLimits } from './protocol.js'
import { formatVfsReference } from '../../vfs/reference.js'

export async function executeCodeAct(context: ToolExecutionContext): Promise<ToolResult> {
  const { invocation, scope, signal } = context
  const source = invocation.rawInput ?? invocation.arguments?.code
  if (typeof source !== 'string') throw new Error('CodeAct requires JavaScript source.')
  const host = createCodeActContext(scope, invocation.id)
  const result = await runCodeActSandbox({ source, methods: host.methods, signal })
  const observations = host.observations.map(item => {
    const reference = formatVfsReference(item)
    const label = item.path.replace(/[\\[\]<>]/g, char => `\\${char}`)
    return `${item.path}:${item.startLine}-${item.endLine} / ${item.totalLines} lines`
      + (item.endLine < item.totalLines ? `; next startLine: ${item.endLine + 1}` : '')
      + (reference ? `\nReference: [${label}](${reference})` : '')
  })
  const text = [
    ...(host.writes.length ? [
      `Saved changes (already applied; later errors or cancellation do not roll them back):\n${host.writes.map(item =>
        `${item.path}: ${item.modified ? 'modified' : 'unchanged'}${item.changesetId ? `; changeset ${item.changesetId}` : ''}`).join('\n')}`,
    ] : []),
    ...(result.error ? [`${result.error.code}: ${result.error.message}`] : []),
    ...(observations.length ? [`Read ranges:\n${observations.join('\n')}`] : []),
    ...(result.output ? [result.output] : []),
    ...(!host.writes.length && !observations.length && !result.output && !result.error ? ['Completed without printed output. Use print(value) to show results.'] : []),
  ].join('\n\n')
  const truncation = '\n[Result truncated. Print smaller selections.]'
  const displayed = text.length > codeActLimits.outputChars
    ? text.slice(0, codeActLimits.outputChars - truncation.length) + truncation : text
  return {
    invocationId: invocation.id, toolId: invocation.toolId,
    status: result.status,
    content: [{ type: 'text', text: displayed }],
    ...(result.error ? { error: result.error } : {}),
  }
}
