import type { ObservationMessage } from './observation-view.js'

/** Presentation only: never cross another message or infer a pair from proximity. */
export function groupObservationMessages(messages: ObservationMessage[]): ObservationMessage[][] {
  const groups: ObservationMessage[][] = []
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]
    const group = [message]
    if (message.role === 'assistant') {
      const pending = new Set(message.exchanges?.flatMap(exchange => exchange.callId ? [exchange.callId] : []))
      while (pending.size && index + 1 < messages.length) {
        const next = messages[index + 1]
        const id = next.exchanges?.length === 1 ? next.exchanges[0].callId : undefined
        if (next.role !== 'tool' || !id || !pending.has(id)) break
        group.push(next)
        pending.delete(id)
        index++
      }
    }
    groups.push(group)
  }
  return groups
}

export function groupedMessageDetail(members: ObservationMessage[]): ObservationMessage {
  const first = members[0]
  if (members.length === 1) return first
  return {
    ...first,
    raw: members.map(message => message.raw),
    exchanges: first.exchanges?.map(exchange => {
      const result = members.slice(1).flatMap(message => message.exchanges ?? []).find(item => item.callId === exchange.callId)
      return result ? { ...exchange, result: result.result, status: result.status } : { ...exchange, result: undefined }
    }),
  }
}
