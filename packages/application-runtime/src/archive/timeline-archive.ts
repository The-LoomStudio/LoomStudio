import { isRecord, type JsonValue } from '@loom-studio/shared'
import type { NarrativeBranch, NarrativeNode, NarrativeTimeline } from '@loom-studio/narrative-store'
import type { StateRevision, StateScope } from '@loom-studio/state-store'

export type TimelineArchive = {
  format: 'loom-timeline-archive.v1'
  exportedAt: string
  timeline: NarrativeTimeline
  branches: NarrativeBranch[]
  nodes: NarrativeNode[]
  state: {
    scope: StateScope
    revisions: StateRevision[]
  }
  participants: TimelineArchiveDataBlock[]
}

export function serializeTimelineArchive(archive: TimelineArchive): string {
  validateTimelineArchive(archive)
  return JSON.stringify(archive)
}

export function parseTimelineArchive(source: string): TimelineArchive {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new Error('Timeline archive is not valid JSON')
  }
  validateTimelineArchive(parsed)
  return parsed
}

function validateTimelineArchive(value: unknown): asserts value is TimelineArchive {
  if (!isRecord(value) || value.format !== 'loom-timeline-archive.v1') {
    throw new Error('Unsupported Timeline archive format')
  }
  if (!isRecord(value.timeline) || !Array.isArray(value.branches) || !Array.isArray(value.nodes)
    || !isRecord(value.state) || !isRecord(value.state.scope) || !Array.isArray(value.state.revisions)
    || !Array.isArray(value.participants)) {
    throw new Error('Timeline archive is incomplete')
  }
  timestamp(value.exportedAt)
  recordHeader(value.timeline)
  identifier(value.timeline.activeBranchId)
  if (value.timeline.title !== undefined) textValue(value.timeline.title)
  if (!Array.isArray(value.timeline.promptResourceIds)) throw new Error('Timeline archive resource references are invalid')
  value.timeline.promptResourceIds.forEach(identifier)
  if (value.timeline.deletedAt !== undefined) throw new Error('Cannot import a deleted Timeline')
  recordHeader(value.state.scope)
  identifier(value.state.scope.ownerId)
  if (value.state.scope.deletedAt !== undefined) throw new Error('Cannot import a deleted State scope')
  for (const branch of value.branches) {
    recordHeader(branch)
    identifier(branch.timelineId)
    identifier(branch.stateHeadRevisionId)
    optionalIdentifier(branch.parentBranchId)
    optionalIdentifier(branch.forkedFromNodeId)
    optionalIdentifier(branch.headNodeId)
    if (branch.title !== undefined) textValue(branch.title)
  }
  for (const node of value.nodes) {
    if (!isRecord(node)) throw new Error('Invalid Timeline archive node')
    identifier(node.id)
    identifier(node.timelineId)
    identifier(node.stateRevisionId)
    timestamp(node.createdAt)
    optionalIdentifier(node.parentNodeId)
    if (!isRecord(node.body) || node.body.format !== 'loom-markdown.v1') throw new Error('Invalid Timeline archive node body')
    textValue(node.body.raw)
    if (!node.body.raw.trim()) throw new Error('Timeline archive node body is empty')
  }
  for (const revision of value.state.revisions) {
    if (!isRecord(revision) || !isRecord(revision.snapshot) || !Array.isArray(revision.operations)
      || revision.operations.some(operation => !isRecord(operation))) throw new Error('Invalid Timeline archive State revision')
    identifier(revision.id)
    identifier(revision.scopeId)
    timestamp(revision.createdAt)
    optionalIdentifier(revision.parentRevisionId)
  }
  for (const block of value.participants) {
    if (!isRecord(block) || typeof block.namespace !== 'string' || !namespacePattern.test(block.namespace)
      || !Number.isSafeInteger(block.version) || Number(block.version) < 1 || block.payload === undefined) {
      throw new Error('Invalid Timeline archive participant block')
    }
  }
  const archive = value as unknown as TimelineArchive
  const branchIds = new Set(archive.branches.map(branch => branch.id))
  if (branchIds.size !== archive.branches.length) throw new Error('Timeline archive contains duplicate branch IDs')
  if (!branchIds.has(archive.timeline.activeBranchId)) {
    throw new Error('Timeline archive active branch is missing')
  }
  const nodeIds = new Set(archive.nodes.map(node => node.id))
  if (nodeIds.size !== archive.nodes.length) throw new Error('Timeline archive contains duplicate node IDs')
  for (const branch of archive.branches) {
    if (branch.timelineId !== archive.timeline.id) throw new Error('Timeline archive branch belongs to another timeline')
    if (branch.headNodeId && !nodeIds.has(branch.headNodeId)) throw new Error('Timeline archive branch head is missing')
    if (branch.parentBranchId && (!branchIds.has(branch.parentBranchId) || !branch.forkedFromNodeId)) throw new Error('Timeline archive branch parent is missing')
    if (!branch.parentBranchId && branch.forkedFromNodeId) throw new Error('Timeline archive root branch cannot have a fork point')
  }
  for (const node of archive.nodes) {
    if (node.timelineId !== archive.timeline.id) throw new Error('Timeline archive node belongs to another timeline')
    if (node.parentNodeId && !nodeIds.has(node.parentNodeId)) throw new Error('Timeline archive node parent is missing')
  }
  if (archive.state.scope.kind !== 'timeline' || archive.state.scope.ownerId !== archive.timeline.id) {
    throw new Error('Timeline archive State scope does not belong to the timeline')
  }
  const revisions = new Set(archive.state.revisions.map(revision => revision.id))
  if (revisions.size !== archive.state.revisions.length) throw new Error('Timeline archive contains duplicate State revision IDs')
  if (new Set(archive.participants.map(block => block.namespace)).size !== archive.participants.length) throw new Error('Duplicate Timeline archive participant namespace')
  for (const branch of archive.branches) if (!revisions.has(branch.stateHeadRevisionId)) throw new Error('Timeline archive branch State head is missing')
  for (const node of archive.nodes) if (!revisions.has(node.stateRevisionId)) throw new Error('Timeline archive node State revision is missing')
  for (const revision of archive.state.revisions) {
    if (revision.scopeId !== archive.state.scope.id) throw new Error('Timeline archive State revision belongs to another scope')
    if (revision.parentRevisionId && !revisions.has(revision.parentRevisionId)) throw new Error('Timeline archive State parent is missing')
  }
}

function identifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Timeline archive contains an invalid ID')
}
function optionalIdentifier(value: unknown) { if (value !== undefined) identifier(value) }
function textValue(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('Timeline archive contains invalid text')
}
function timestamp(value: unknown) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('Timeline archive contains an invalid timestamp')
}
function recordHeader(value: unknown): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Timeline archive contains an invalid record')
  identifier(value.id)
  timestamp(value.createdAt)
  timestamp(value.updatedAt)
}

export type TimelineArchiveExportInput = {
  timelineId: string
  branchIds: string[]
  nodeIds: string[]
  stateRevisionIds: string[]
}

export type TimelineArchiveIdMap = {
  timelineId: string
  branchIds: Record<string, string>
  nodeIds: Record<string, string>
  stateRevisionIds: Record<string, string>
}

export type TimelineArchiveImportInput = {
  timelineId: string
  idMap: TimelineArchiveIdMap
  payload: JsonValue
}

export type TimelineArchiveParticipant = {
  namespace: string
  version: number
  export(input: TimelineArchiveExportInput): Promise<JsonValue | undefined> | JsonValue | undefined
  import(input: TimelineArchiveImportInput): Promise<void> | void
}

export type TimelineArchiveParticipantHandle = {
  unregister(): void
}

export type TimelineArchiveParticipantRegistry = {
  register(participant: TimelineArchiveParticipant): TimelineArchiveParticipantHandle
  list(): TimelineArchiveParticipant[]
  exportParticipants(input: TimelineArchiveExportInput): Promise<TimelineArchiveDataBlock[]>
  importParticipants(input: {
    blocks: TimelineArchiveDataBlock[]
    timelineId: string
    idMap: TimelineArchiveIdMap
  }): Promise<{ unknownNamespaces: string[]; failures: Array<{ namespace: string; message: string }> }>
}

export type TimelineArchiveDataBlock = {
  namespace: string
  version: number
  payload: JsonValue
}

export type TimelineArchivePendingContent = {
  timelineId: string
  blocks: TimelineArchiveDataBlock[]
  failures: Array<{ namespace: string; message: string }>
  createdAt: string
  updatedAt: string
}

export function timelineArchivePendingId(timelineId: string): string {
  return `timeline-archive-pending:${timelineId}`
}

const namespacePattern = /^[a-z][a-z0-9._-]{0,127}$/

export function createTimelineArchiveParticipantRegistry(
  initial: TimelineArchiveParticipant[] = [],
): TimelineArchiveParticipantRegistry {
  const participants = new Map<string, TimelineArchiveParticipant>()
  for (const participant of initial) registerParticipant(participants, participant)

  return {
    register(participant) {
      registerParticipant(participants, participant)
      return {
        unregister() {
          if (participants.get(participant.namespace) === participant) participants.delete(participant.namespace)
        },
      }
    },
    list: () => [...participants.values()].sort((left, right) => left.namespace.localeCompare(right.namespace)),
    async exportParticipants(input) {
      const blocks: TimelineArchiveDataBlock[] = []
      for (const participant of participants.values()) {
        const payload = await participant.export(input)
        if (payload !== undefined) blocks.push({ namespace: participant.namespace, version: participant.version, payload })
      }
      return blocks.sort((left, right) => left.namespace.localeCompare(right.namespace))
    },
    async importParticipants(input) {
      const unknownNamespaces = new Set<string>()
      const failures: Array<{ namespace: string; message: string }> = []
      for (const block of input.blocks) {
        const participant = participants.get(block.namespace)
        if (!participant) {
          unknownNamespaces.add(block.namespace)
          continue
        }
        try {
          await participant.import({ timelineId: input.timelineId, idMap: input.idMap, payload: block.payload })
        } catch (error) {
          failures.push({ namespace: block.namespace, message: error instanceof Error ? error.message : String(error) })
        }
      }
      return { unknownNamespaces: [...unknownNamespaces].sort(), failures }
    },
  }
}

function registerParticipant(
  participants: Map<string, TimelineArchiveParticipant>,
  participant: TimelineArchiveParticipant,
): void {
  if (!namespacePattern.test(participant.namespace)) {
    throw new Error(`Invalid Timeline archive participant namespace: ${participant.namespace}`)
  }
  if (!Number.isSafeInteger(participant.version) || participant.version < 1) {
    throw new Error(`Invalid Timeline archive participant version: ${participant.namespace}`)
  }
  if (participants.has(participant.namespace)) {
    throw new Error(`Timeline archive participant namespace already registered: ${participant.namespace}`)
  }
  participants.set(participant.namespace, participant)
}
