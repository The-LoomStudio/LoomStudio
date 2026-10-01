import type { ToolExecutionContext, ToolResult } from '../tool-registry.js'
import { createCodeActContext, narrativePath } from './context.js'
import { runCodeActSandbox } from './sandbox.js'
import { codeActLimits } from './protocol.js'

export async function executeCodeAct(context: ToolExecutionContext): Promise<ToolResult> {
  const { invocation, scope, signal } = context
  const source = invocation.rawInput ?? invocation.arguments?.code
  if (typeof source !== 'string') throw new Error('CodeAct requires JavaScript source.')
  if (invocation.transport === 'content' && source.trimStart().startsWith('{')) {
    let wrapper: unknown
    try { wrapper = JSON.parse(source) } catch { /* A JavaScript block is not a JSON envelope. */ }
    if (wrapper && typeof wrapper === 'object' && 'code' in wrapper) {
      const message = 'codeact is Freeform JavaScript, not JSON. Nothing was executed. Retry in assistant content: <loom_tool name="codeact"><metadata>{}</metadata><content>print(await ctx.ls("/"));</content></loom_tool>. Put raw JavaScript inside <content>, not {"code":"..."}. Only codeact_json accepts {"code":"..."} through native tool_calls, if it is enabled.'
      return {
        invocationId: invocation.id, toolId: invocation.toolId, status: 'failed',
        content: [{ type: 'text', text: message }],
        error: { code: 'codeact.json_envelope', message },
      }
    }
  }
  const host = createCodeActContext(scope, invocation.id)
  const result = await runCodeActSandbox({ source, methods: host.methods, signal })
  const observations = host.observations.map(item => {
    return `${item.path}:${item.startLine}-${item.endLine} / ${item.totalLines} lines`
      + (item.endLine < item.totalLines ? `; next startLine: ${item.endLine + 1}` : '')
  })
  const text = [
    ...(host.narrativeAppends.length ? [
      `Narrative saved:\n${host.narrativeAppends.map(item => narrativePath(item.nodeId)).join('\n')}${result.error ? '\nAlready applied; do not repeat these writes.' : ''}`,
    ] : []),
    ...(host.writes.length ? [
      `Saved changes (already applied; later errors or cancellation do not roll them back):\n${host.writes.map(item =>
        `${item.path}: ${item.modified ? 'modified' : 'unchanged'}${item.changesetId ? `; changeset ${item.changesetId}` : ''}`).join('\n')}`,
    ] : []),
    ...(result.error ? [`${result.error.code}: ${result.error.message}`] : []),
    ...(observations.length ? [`Read ranges:\n${observations.join('\n')}`] : []),
    ...(result.output ? [result.output.split('\n').filter(line =>
      !host.narrativeAppends.some(item => line === JSON.stringify({ path: narrativePath(item.nodeId) }))).join('\n')].filter(Boolean) : []),
    ...(!host.narrativeAppends.length && !host.writes.length && !observations.length && !result.output && !result.error ? ['Completed without printed output. Use print(value) to show results.'] : []),
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
