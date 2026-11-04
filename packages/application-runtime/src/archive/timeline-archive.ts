import { validateWorkspaceEntries, type WorkspaceRevision } from '@loom-studio/application-data'
import { isRecord, normalizeMacroSelections, type JsonValue, type MacroSelectionMap } from '@loom-studio/shared'
import type { AgentSession, AgentTranscriptEntry, NarrativeSwipeGroup, NarrativeBranch, NarrativeNode, NarrativeTimeline, NarrativeRecoveryPoint } from '@loom-studio/application-data'
import type { StateRevision, StateScope } from '@loom-studio/application-data'
import type { TimelineRuntimeContextContent } from '../types.js'
import { playerProfilePath } from '@loom-studio/shared'
import { validateStateContribution } from '../state/state-contribution.js'
import { validateStateDefinitionDraft, validateStateValue } from '../state/state-definition.js'
import { assertAuthorPlayerState, createPlayerStateContribution } from '../profiles/player-state.js'
import { isDeepStrictEqual } from 'node:util'
import { parseAgentRunMaterialBaseline } from '../agents/run-recovery.js'

export type TimelineArchive = {
  format: 'loom-timeline-archive.v2'
  exportedAt: string
  agent: { session: AgentSession; entries: AgentTranscriptEntry[]; swipeGroups: NarrativeSwipeGroup[] }
  timeline: NarrativeTimeline
  branches: NarrativeBranch[]
  nodes: NarrativeNode[]
  recoveryPoints?: NarrativeRecoveryPoint[]
  state: {
    scope: StateScope
    revisions: StateRevision[]
  }
  workspace: { revisions: WorkspaceRevision[]; blobs: Array<{ id: string; base64: string; mediaType?: string }> }
  participants: TimelineArchiveDataBlock[]
  macroConfigurations?: Array<{ presetId: string; macroSelections: MacroSelectionMap }>
  runtimeContext: TimelineRuntimeContextContent
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
  if (!isRecord(value) || value.format !== 'loom-timeline-archive.v2') {
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
  if (value.timeline.opening !== undefined) {
    const opening = value.timeline.opening
    if (!isRecord(opening) || typeof opening.locked !== 'boolean'
      || (opening.custom !== undefined && typeof opening.custom !== 'boolean')) {
      throw new Error('Invalid Timeline archive opening')
    }
    if (opening.id !== undefined) identifier(opening.id)
    if (opening.nodeId !== undefined) identifier(opening.nodeId)
  }
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
    if (node.kind !== 'user-input' && node.kind !== 'narrative') throw new Error('Invalid Timeline archive node kind')
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
  validateRuntimeContext(archive)
  validateAgentArchive(archive)
  if (!archive.workspace) throw new Error('Timeline archive Workspace block is missing')
  if (value.macroConfigurations !== undefined) {
    if (!Array.isArray(value.macroConfigurations)) throw new Error('Invalid archived macro configurations')
    const presets = new Set<string>()
    for (const config of value.macroConfigurations) {
      if (!isRecord(config)) throw new Error('Invalid archived macro configuration')
      identifier(config.presetId)
      if (presets.has(config.presetId)) throw new Error('Duplicate archived macro configuration')
      presets.add(config.presetId)
      normalizeMacroSelections(config.macroSelections)
    }
  }
  const branchIds = new Set(archive.branches.map(branch => branch.id))
  if (branchIds.size !== archive.branches.length) throw new Error('Timeline archive contains duplicate branch IDs')
  if (!branchIds.has(archive.timeline.activeBranchId)) {
    throw new Error('Timeline archive active branch is missing')
  }
  const nodeIds = new Set(archive.nodes.map(node => node.id))
  if (archive.timeline.opening?.nodeId && !nodeIds.has(archive.timeline.opening.nodeId)) throw new Error('Timeline archive opening node is missing')
  if (nodeIds.size !== archive.nodes.length) throw new Error('Timeline archive contains duplicate node IDs')
  for (const branch of archive.branches) {
    if (branch.timelineId !== archive.timeline.id) throw new Error('Timeline archive branch belongs to another timeline')
    if (branch.headNodeId && !nodeIds.has(branch.headNodeId)) throw new Error('Timeline archive branch head is missing')
    if (branch.forkedFromNodeId && !nodeIds.has(branch.forkedFromNodeId)) throw new Error('Timeline archive fork point is missing')
    if (branch.parentBranchId && (!branchIds.has(branch.parentBranchId) || !branch.forkedFromNodeId)) throw new Error('Timeline archive branch parent is missing')
    if (!branch.parentBranchId && branch.forkedFromNodeId) throw new Error('Timeline archive root branch cannot have a fork point')
  }
  for (const node of archive.nodes) {
    if (node.timelineId !== archive.timeline.id) throw new Error('Timeline archive node belongs to another timeline')
    if (node.parentNodeId && !nodeIds.has(node.parentNodeId)) throw new Error('Timeline archive node parent is missing')
  }
  const floors = new Map<string, number>()
  const remaining = new Map(archive.nodes.map(node => [node.id, node]))
  while (remaining.size) {
    const before = remaining.size
    for (const [id, node] of remaining) {
      if (node.parentNodeId && !floors.has(node.parentNodeId)) continue
      const parent = node.parentNodeId ? floors.get(node.parentNodeId)! : 0
      if (!Number.isSafeInteger(node.floor) || node.floor <= parent) throw new Error('Invalid archived Narrative floor')
      floors.set(id, node.floor); remaining.delete(id)
    }
    if (before === remaining.size) throw new Error('Timeline archive contains a Narrative cycle')
  }
  if (!archive.workspace && (archive.nodes.some(node => node.workspaceRevisionId !== undefined) || archive.branches.some(branch => branch.workspaceHeadRevisionId !== undefined))) throw new Error('Timeline archive Workspace block is missing')
  if (archive.recoveryPoints !== undefined && !archive.workspace) throw new Error('Recovery points require archived Workspace revisions')
  if (archive.workspace) {
    if (!Array.isArray(archive.workspace.revisions) || !Array.isArray(archive.workspace.blobs)) throw new Error('Invalid Workspace archive')
    const ids = new Set<string>()
    for (const revision of archive.workspace.revisions) {
      identifier(revision.id)
      if (revision.timelineId !== archive.timeline.id || ids.has(revision.id)) throw new Error('Invalid archived Workspace identity')
      ids.add(revision.id); validateWorkspaceEntries(revision.entries)
    }
    for (const revision of archive.workspace.revisions) if (revision.parentRevisionId && !ids.has(revision.parentRevisionId)) throw new Error('Workspace parent is missing')
    for (const branch of archive.branches) if (!ids.has(branch.workspaceHeadRevisionId)) throw new Error('Workspace branch revision is missing')
    for (const node of archive.nodes) if (!ids.has(node.workspaceRevisionId)) throw new Error('Workspace node revision is missing')
    if (archive.recoveryPoints !== undefined && !Array.isArray(archive.recoveryPoints)) throw new Error('Invalid recovery points')
    for (const point of archive.recoveryPoints ?? []) if (!point || !branchIds.has(point.branchId) || !nodeIds.has(point.nodeId)
      || !ids.has(point.workspaceRevisionId) || !archive.state.revisions.some(revision => revision.id === point.stateRevisionId)) throw new Error('Invalid recovery point reference')
    const blobs = new Set<string>()
    for (const blob of archive.workspace.blobs) {
      identifier(blob.id); textValue(blob.base64)
      if (blobs.has(blob.id) || Buffer.from(blob.base64, 'base64').toString('base64') !== blob.base64) throw new Error('Invalid archived Workspace bytes')
      blobs.add(blob.id)
    }
    for (const revision of archive.workspace.revisions) for (const entry of revision.entries)
      if (entry.kind === 'file' && 'blobId' in entry.content && !blobs.has(entry.content.blobId)) throw new Error('Workspace Blob is missing')
  }
  if (archive.state.scope.kind !== 'timeline' || archive.state.scope.ownerId !== archive.timeline.id) {
    throw new Error('Timeline archive State scope does not belong to the timeline')
  }
  const revisions = new Set(archive.state.revisions.map(revision => revision.id))
  if (revisions.size !== archive.state.revisions.length) throw new Error('Timeline archive contains duplicate State revision IDs')
  for (const block of archive.participants) {
    if (block.idMap === undefined) continue
    const map = block.idMap
    if (!isRecord(map) || map.timelineId !== archive.timeline.id) throw new Error('Invalid participant timeline mapping')
    for (const [field, allowed] of [['branchIds', branchIds], ['nodeIds', nodeIds], ['stateRevisionIds', revisions]] as const) {
      if (!isRecord(map[field])) throw new Error('Invalid participant ID mapping')
      for (const [source, target] of Object.entries(map[field])) {
        identifier(source)
        if (typeof target !== 'string' || !allowed.has(target)) throw new Error('Participant mapping target is outside the archive')
      }
    }
  }
  if (new Set(archive.participants.map(block => block.namespace)).size !== archive.participants.length) throw new Error('Duplicate Timeline archive participant namespace')
  for (const branch of archive.branches) if (!revisions.has(branch.stateHeadRevisionId)) throw new Error('Timeline archive branch State head is missing')
  for (const node of archive.nodes) if (!revisions.has(node.stateRevisionId)) throw new Error('Timeline archive node State revision is missing')
  for (const revision of archive.state.revisions) {
    if (revision.scopeId !== archive.state.scope.id) throw new Error('Timeline archive State revision belongs to another scope')
    if (revision.parentRevisionId && !revisions.has(revision.parentRevisionId)) throw new Error('Timeline archive State parent is missing')
  }
}

function validateRuntimeContext(archive: TimelineArchive): void {
  const context = archive.runtimeContext!
  if (!isRecord(context) || context.timelineId !== archive.timeline.id
    || !Number.isSafeInteger(context.sourceCardVersion) || context.sourceCardVersion < 1
    || !Array.isArray(context.stateEntityTypes) || !Array.isArray(context.stateEntities)
    || !Array.isArray(context.stateComponents) || !Array.isArray(context.stateReferences)
    || !Array.isArray(context.stateContributionSources) || !Array.isArray(context.stateBindings)) {
    throw new Error('Invalid Timeline archive runtime context')
  }
  identifier(context.sourceCardId)
  if (context.cardName !== undefined) textValue(context.cardName)
  timestamp(context.createdAt)
  validateStateContribution({ id: 'archive.entities', entityTypes: context.stateEntityTypes,
    entities: context.stateEntities, templates: [], componentMounts: [], bindings: [] })
  for (const binding of context.stateBindings) {
    if (!isRecord(binding) || typeof binding.path !== 'string' || !binding.path || !isRecord(binding.schema))
      throw new Error('Invalid Timeline archive State binding')
    optionalIdentifier(binding.installationId)
    validateStateDefinitionDraft({ kind: 'global', path: 'global.archive', schema: binding.schema })
  }
  for (const component of context.stateComponents) {
    if (!isRecord(component) || typeof component.path !== 'string' || !isRecord(component.schema))
      throw new Error('Invalid Timeline archive component')
    identifier(component.templateId)
    identifier(component.componentKey)
    validateStateDefinitionDraft({ kind: 'global', path: 'global.archive', schema: component.schema })
  }
  for (const reference of context.stateReferences) {
    if (!isRecord(reference) || typeof reference.path !== 'string' || !isRecord(reference.annotation)
      || !Array.isArray(reference.annotation.allowedTypeIds)) throw new Error('Invalid Timeline archive State reference')
    reference.annotation.allowedTypeIds.forEach(identifier)
  }
  for (const source of context.stateContributionSources) {
    if (!isRecord(source)) throw new Error('Invalid Timeline archive State source')
    for (const key of ['installationId', 'contributionId', 'packageId', 'moduleId', 'packageVersion'] as const) identifier(source[key])
    validateStateContribution(source.declaration, { allowExternalReferences: true })
    assertAuthorPlayerState(source.declaration)
  }
  const profileBinding = context.stateBindings.find(binding => binding.path === playerProfilePath)
  const expectedSchema = createPlayerStateContribution({ name: 'User', description: '' }).templates[0]!.schema
  if (!profileBinding || !isDeepStrictEqual(profileBinding.schema, expectedSchema)) throw new Error('Invalid archived player profile Schema')
  for (const revision of archive.state.revisions) {
    let profile: JsonValue = revision.snapshot
    for (const segment of playerProfilePath.split('.')) {
      if (!isRecord(profile) || !Object.hasOwn(profile, segment)) throw new Error('Archived player profile is missing')
      profile = profile[segment] as JsonValue
    }
    validateStateValue(profile, expectedSchema, playerProfilePath)
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
  /** Original payload IDs mapped into this archive. */
  idMap?: TimelineArchiveIdMap
  namespace: string
  version: number
  payload: JsonValue
}

export type TimelineArchivePendingContent = {
  idMap?: TimelineArchiveIdMap
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
          await participant.import({ timelineId: input.timelineId, payload: block.payload, idMap: composeTimelineArchiveIdMap(block.idMap, input.idMap) })
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

/** Compose original payload references through another archive import; never retain old targets. */
export function composeTimelineArchiveIdMap(previous: TimelineArchiveIdMap | undefined, next: TimelineArchiveIdMap): TimelineArchiveIdMap {
  if (!previous) return next
  const remap = (before: Record<string, string>, after: Record<string, string>) => Object.fromEntries(Object.entries(before).map(([source, intermediate]) => {
    const target = Object.hasOwn(after, intermediate) ? after[intermediate] : undefined
    if (!target) throw new Error('Participant mapping target is outside the imported archive')
    return [source, target]
  }))
  return { timelineId: next.timelineId, branchIds: remap(previous.branchIds, next.branchIds),
    nodeIds: remap(previous.nodeIds, next.nodeIds), stateRevisionIds: remap(previous.stateRevisionIds, next.stateRevisionIds) }
}

function validateAgentArchive(archive: TimelineArchive) {
  const agent = archive.agent
  if (!agent || !isRecord(agent.session) || !Array.isArray(agent.entries) || !Array.isArray(agent.swipeGroups))
    throw new Error('Timeline archive Agent history is missing')
  const session = agent.session
  recordHeader(session)
  if (session.id !== archive.timeline.id || session.timelineId !== archive.timeline.id || session.kind !== 'timeline' || session.deletedAt !== undefined)
    throw new Error('Timeline archive root Session identity is invalid')
  optionalIdentifier(session.agentPresetId)
  if (session.narrativeMode !== 'declared' && session.narrativeMode !== 'automatic') throw new Error('Invalid archived Narrative mode')
  const entries = new Map<string, AgentTranscriptEntry>()
  const sequences = new Set<number>()
  for (const entry of agent.entries) {
    if (!isRecord(entry) || !isRecord(entry.entry)) throw new Error('Invalid archived Agent Entry')
    identifier(entry.id); timestamp(entry.createdAt); optionalIdentifier(entry.runId)
    optionalIdentifier(entry.parentEntryId); optionalIdentifier(entry.roundId); optionalIdentifier(entry.candidateId)
    if (entry.agentSessionId !== session.id || entries.has(entry.id) || !Number.isSafeInteger(entry.sequence)
      || entry.sequence < 1 || sequences.has(entry.sequence)) throw new Error('Invalid archived Agent Entry identity or sequence')
    entries.set(entry.id, entry); sequences.add(entry.sequence)
  }
  const reference = (id: string | undefined) => { if (id !== undefined && !entries.has(id)) throw new Error('Timeline archive Entry reference is missing') }
  reference(session.headEntryId)
  if (!Number.isSafeInteger(session.entryCount) || session.entryCount < agent.entries.reduce((maximum, entry) => Math.max(maximum, entry.sequence), 0)) throw new Error('Invalid archived Session write count')
  for (const entry of entries.values()) {
    reference(entry.parentEntryId)
    if (entry.parentEntryId && entries.get(entry.parentEntryId)!.sequence >= entry.sequence) throw new Error('Invalid archived Entry parent order')
    if (entry.entry.kind === 'message') {
      reference(entry.entry.continuesEntryId)
      if (entry.entry.editBaseline !== undefined) parseAgentRunMaterialBaseline(entry.entry.editBaseline)

    }
    if (entry.entry.kind === 'run-state' && entry.entry.recovery) {
      const recovery = entry.entry.recovery
      if (recovery.materialBaseline !== undefined) parseAgentRunMaterialBaseline(recovery.materialBaseline)
    }
    if (entry.entry.kind === 'work-summary') {
      const boundary = entry.entry.boundary
      if (!isRecord(boundary) || !Number.isSafeInteger(boundary.sourceThroughSequence)
        || !Number.isSafeInteger(boundary.retiredThroughSequence) || boundary.retiredThroughSequence < 0
        || boundary.sourceThroughSequence < boundary.retiredThroughSequence || boundary.sourceThroughSequence >= entry.sequence)
        throw new Error('Invalid archived summary boundary')
    }
  }
  for (const node of archive.nodes) {
    reference(node.entryId)
    const entry = node.entryId ? entries.get(node.entryId)?.entry : undefined
    if (!entry || entry.kind !== 'message' || entry.content !== node.body.raw) throw new Error('Timeline archive Narrative projection differs from its message')
    if (node.source?.agentSessionId === session.id && node.source.agentMessageId) reference(node.source.agentMessageId)
  }
  for (const branch of archive.branches) reference(branch.headEntryId)
  for (const point of archive.recoveryPoints ?? []) reference(point.headEntryId)
  const active = archive.branches.find(branch => branch.id === archive.timeline.activeBranchId)
  if (active?.headEntryId !== session.headEntryId) throw new Error('Timeline archive active Entry head differs from its root Session')
  const groups = new Set<string>()
  const candidates = new Set<string>()
  for (const group of agent.swipeGroups) {
    if (!isRecord(group) || !Array.isArray(group.candidates)) throw new Error('Invalid archived Swipe group')
    identifier(group.id)
    if (group.inputKind !== undefined && group.inputKind !== 'communication') throw new Error('Invalid archived Swipe input kind')
    if (groups.has(group.id) || group.timelineId !== session.id || group.agentSessionId !== session.id
      || !archive.branches.some(branch => branch.id === group.branchId)
      || (group.inputNodeId === undefined ? group.inputKind !== 'communication'
        : !archive.nodes.some(node => node.id === group.inputNodeId))) throw new Error('Invalid archived Swipe ownership')
    groups.add(group.id); reference(group.baseEntryId)
    for (const candidate of group.candidates) {
      identifier(candidate.id)
      if (candidates.has(candidate.id) || candidate.agentSessionId !== session.id || !Array.isArray(candidate.runIds)) throw new Error('Invalid archived Swipe candidate')
      candidates.add(candidate.id); reference(candidate.headEntryId)
      if (candidate.inputNodeId && !archive.nodes.some(node => node.id === candidate.inputNodeId)
        || candidate.headNodeId && !archive.nodes.some(node => node.id === candidate.headNodeId)) throw new Error('Archived Swipe node reference is missing')
      if (!archive.state.revisions.some(revision => revision.id === candidate.stateRevisionId)
        || candidate.workspaceRevisionId && !archive.workspace?.revisions.some(revision => revision.id === candidate.workspaceRevisionId)) throw new Error('Archived Swipe material revision is missing')
    }
    for (const id of [group.activeCandidateId, group.selectedCandidateId]) if (id && !group.candidates.some(candidate => candidate.id === id)) throw new Error('Archived Swipe selection is missing')
  }
  for (const entry of entries.values()) {
    if (entry.roundId && !groups.has(entry.roundId) && !agent.entries.some(input => input.id === entry.roundId && input.entry.kind === 'message' && input.entry.role === 'user' && input.entry.purpose === 'narrative') || entry.candidateId && !candidates.has(entry.candidateId)) throw new Error('Archived Entry round or candidate reference is missing')
  }
}
