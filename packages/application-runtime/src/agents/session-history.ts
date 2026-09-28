import type { AgentStore, AgentTranscriptEntry, AgentTranscriptEntryData } from '@loom-studio/application-data'
import type { ChatMessage } from '@loom-studio/shared'
import { renderLoomContentToolResult } from './content-transport.js'
import { renderToolResult } from './tool-result-text.js'

type Invocation = Extract<AgentTranscriptEntryData, { kind: 'tool-invocation' }>
type Result = Extract<AgentTranscriptEntryData, { kind: 'tool-result' }>

export type SessionHistoryBlock = {
  entry: AgentTranscriptEntry
  messages: ChatMessage[]
}

export function projectSessionHistory(
  entries: AgentTranscriptEntry[],
  textById: Map<string, string>,
): SessionHistoryBlock[] {
  const results = new Map(entries.flatMap(entry =>
    entry.entry.kind === 'tool-result' ? [[entry.entry.invocationId, entry.entry] as const] : []))
  const consumed = new Set<string>()
  const nativeIds = new Set<string>()
  const blocks: SessionHistoryBlock[] = []
  const add = (entry: AgentTranscriptEntry, messages: ChatMessage[]) => {
    if (messages.length) blocks.push({ entry, messages })
  }
  for (let index = 0; index < entries.length; index++) {
    const record = entries[index]!
    const data = record.entry
    if (data.kind === 'message') {
      const text = textById.get(record.id)
      if (text === undefined) throw new Error(`Session message has no projected text: ${record.id}`)
      if (text.trim()) add(record, [{ role: data.role, content: text }])
    } else if (data.kind === 'reasoning' && data.replay === 'assistant-content' && data.content.trim()) {
      const dialect = data.dialect && (/^[A-Za-z][A-Za-z0-9_.-]*$/.test(data.dialect) ? data.dialect : 'reasoning')
      add(record, [{ role: 'assistant', content: dialect ? `<${dialect}>${data.content}</${dialect}>` : data.content }])
    } else if (data.kind === 'tool-invocation') {
      const group: Array<{ record: AgentTranscriptEntry; call: Invocation; result?: Result }> = []
      do {
        const item = entries[index]!
        const call = item.entry as Invocation
        group.push({ record: item, call, result: results.get(call.invocationId) })
        consumed.add(call.invocationId)
        index++
      } while (index < entries.length && entries[index]!.entry.kind === 'tool-invocation'
        && entries[index]!.runId === record.runId)
      index--
      const messages: ChatMessage[] = []
      const native = group.filter(item =>
        item.call.transport === 'native-function' && item.call.providerItemId && item.result)
      if (native.length) {
        const calls = native.map(({ call, record }) => {
          // Provider IDs may be reused in later runs; keep each replayed pair unambiguous.
          const id = nativeIds.has(call.providerItemId!) ? record.id : call.providerItemId!
          nativeIds.add(id)
          return {
            id, type: 'function' as const,
            function: { name: call.exposedName, arguments: JSON.stringify(call.arguments ?? {}) },
          }
        })
        messages.push({ role: 'assistant', tool_calls: calls })
        native.forEach(({ result }, position) => messages.push({
          role: 'tool', tool_call_id: calls[position]!.id, content: renderToolResult(result!),
        }))
      }
      const content = group.filter(item => item.call.transport === 'content' && item.result)
      if (content.length) {
        messages.push({
          role: 'assistant',
          content: content.map(({ call }) =>
            `<loom_tool name="${escapeAttribute(call.exposedName)}"><metadata>${JSON.stringify(call.arguments ?? {})}</metadata><content>${call.rawInput ?? ''}</content></loom_tool>`,
          ).join('\n'),
        })
        content.forEach(({ call, result }) => messages.push({
          role: 'user',
          content: renderLoomContentToolResult({
            invocationId: call.invocationId, name: call.exposedName,
            status: result!.status === 'completed' ? 'completed' : 'failed',
            content: renderToolResult(result!),
          }),
        }))
      }
      for (const item of group) {
        const { call, result } = item
        if (native.includes(item) || content.includes(item)) continue
        messages.push({
          role: 'assistant',
          content: `[Recorded tool invocation: ${call.exposedName}; ${result ? `status: ${result.status}` : 'result not recorded; execution outcome unknown; do not assume it is safe to repeat'}]\n`
            + `${JSON.stringify(call.arguments ?? {})}\n${call.rawInput ?? ''}`
            + (result ? `\n${renderToolResult(result)}` : ''),
        })
      }
      add(record, messages)
    } else if (data.kind === 'tool-result' && !consumed.has(data.invocationId)) {
      add(record, [{
        role: 'assistant',
        content: `[Recorded tool result: ${data.toolId}; status: ${data.status}; invocation not in supplied history]\n${renderToolResult(data)}`,
      }])
    }
  }
  return blocks
}

export async function readSessionHistory(
  store: AgentStore, agentSessionId: string,
) {
  const page = await store.getEntryPage({ agentSessionId, limit: 100 })
  const summary = await store.getLatestWorkSummary(agentSessionId)
  const pages = [page.entries]
  let cursor = page.nextCursor
  let oldestSequence = page.entries[0]?.sequence ?? 0
  // Page size is not retention. Only a committed handoff can retire a work segment.
  while (cursor && oldestSequence > (summary?.sequence ?? 0)) {
    const older = await store.getEntryPage({ agentSessionId, cursor, limit: 100 })
    pages.push(older.entries)
    oldestSequence = older.entries[0]?.sequence ?? 0
    cursor = older.nextCursor
  }
  const entries = pages.reverse().flat()
  if (summary) {
    return { ...page, entries: [summary, ...entries.filter(entry => entry.sequence > summary.sequence)], nextCursor: summary.parentEntryId }
  }
  return { ...page, entries, nextCursor: cursor }
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
