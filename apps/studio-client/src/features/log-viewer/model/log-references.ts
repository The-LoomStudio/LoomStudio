import { formatEntityReference, parseResourceLink, type EntityReference } from '@loom-studio/shared'
import type { LogRecord } from '@loom-studio/logging'

export function readLogReferences(record: LogRecord): { uri: string; type: EntityReference['type'] | 'source' }[] {
  const refs: { uri: string; type: EntityReference['type'] | 'source' }[] = []
  const fields: [string, EntityReference['type']][] = [
    ['cardId', 'card'], ['timelineId', 'timeline'], ['sessionId', 'session'], ['agentSessionId', 'session'],
    ['runId', 'run'], ['resourceId', 'resource'], ['providerProfileId', 'provider'],
  ]
  for (const [key, type] of fields) {
    const id = record.data?.[key]
    if (typeof id === 'string' && id && !/[\u0000-\u001f\u007f]/.test(id) && id.length < 1024)
      refs.push({ uri: formatEntityReference({ kind: 'entity', type, id }), type })
  }
  if (record.extension) refs.push({ uri: formatEntityReference({ kind: 'entity', type: 'extension', id: record.extension.packageId }), type: 'extension' })
  const uri = record.data?.resourceUri
  if (typeof uri === 'string' && parseResourceLink(uri)) refs.push({ uri, type: 'source' })
  return refs.filter((ref, index) => refs.findIndex(other => other.uri === ref.uri) === index)
}
