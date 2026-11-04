import type { ObservationMessage, ObservationStep } from './observation-view.js'

export type TokenPart = { id: string; text: string; group: string; messageId?: string; sourceId?: string; anchor?: string; activation?: string }
export function messageTokenParts(messages: ObservationMessage[]): TokenPart[] {
  return messages.flatMap(message => [
    { id: `${message.id}:text`, text: message.content, group: message.role, messageId: message.id },
    ...(message.toolCalls ?? []).map((call, index) => ({ id: `${message.id}:call:${index}`, text: JSON.stringify(call), group: 'calls', messageId: message.id })),
  ])
}
export function definitionTokenParts(definitions: unknown[] = []): TokenPart[] {
  return definitions.map((value, index) => ({ id: `definition:${index}`, text: JSON.stringify(value), group: 'definitions' }))
}
export function sourceTokenParts(step: Pick<ObservationStep, 'sources'>): TokenPart[] {
  // Only captured emissions are counted; container/source renderings can duplicate them.
  return step.sources.flatMap(source => (source.injections ?? []).map(injection => ({
    id: injection.id, text: injection.rendered, group: source.title, sourceId: source.id,
    anchor: injection.targetAnchorId, activation: source.activationKind,
  })))
}
export function sumTokenParts(parts: TokenPart[], counts: Map<string, number | undefined>): number | undefined {
  let total = 0
  for (const part of parts) {
    const count = counts.get(part.text)
    if (count === undefined) return undefined
    total += count
  }
  return total
}
export function messagePreview(message: ObservationMessage, query = ''): string {
  const text = [message.content, ...(message.toolCalls ?? []).map(call => `${call.name} ${call.arguments}`)].filter(Boolean).join('\n')
  const match = query ? text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) : 0
  const start = Math.max(0, match - 70)
  return `${start ? '…' : ''}${text.slice(start, start + 320)}${text.length > start + 320 ? '…' : ''}`
}
export function messageMatches(message: ObservationMessage, query: string): boolean {
  return [message.role, message.content, ...(message.toolCalls ?? []).flatMap(call => [call.name, call.arguments])].some(text => text.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
}
