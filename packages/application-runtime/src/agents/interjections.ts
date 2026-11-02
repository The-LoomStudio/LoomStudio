import type { AgentStore, AgentTranscriptEntry } from '@loom-studio/application-data'

/** Serializes receipt and transcript writes, never Provider or tool execution. */
const locks = new WeakMap<AgentStore, Map<string, Promise<unknown>>>()
export async function withInterjectionLock<T>(agents: AgentStore, sessionId: string, work: () => Promise<T>): Promise<T> {
  let sessions = locks.get(agents)
  if (!sessions) { sessions = new Map(); locks.set(agents, sessions) }
  const previous = sessions.get(sessionId) ?? Promise.resolve()
  const pending = previous.catch(() => undefined).then(work)
  sessions.set(sessionId, pending)
  try { return await pending }
  finally { if (sessions.get(sessionId) === pending) sessions.delete(sessionId) }
}

export type UserInterjection = AgentTranscriptEntry & { entry: Extract<AgentTranscriptEntry['entry'], { kind: 'user-interjection' }> }
export function pendingInterjections(entries: AgentTranscriptEntry[]): UserInterjection[] {
  const applied = new Set(entries.flatMap(item => item.entry.kind === 'interjection-applied' || item.entry.kind === 'interjection-discarded' ? [item.entry.requestId] : []))
  return entries.filter((item): item is UserInterjection => item.entry.kind === 'user-interjection' && !item.entry.withdrawn && !applied.has(item.entry.requestId))
    .sort((left, right) => left.sequence - right.sequence)
}

/** Follow the selected branch ancestry; unrelated fork receipts are not file grants. */
export function branchTranscriptEntries(entries: AgentTranscriptEntry[], headEntryId: string | undefined): AgentTranscriptEntry[] {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  const selected: AgentTranscriptEntry[] = []
  let cursor = headEntryId
  while (cursor) {
    const entry = byId.get(cursor)
    if (!entry) throw new Error(`Session transcript ancestor is missing: ${cursor}`)
    selected.push(entry)
    cursor = entry.parentEntryId
  }
  return selected.reverse()
}
