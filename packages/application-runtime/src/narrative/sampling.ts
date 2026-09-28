import type { NarrativeNode, NarrativeStore } from '@loom-studio/application-data'
import type { TextTransformDiagnostic, TextTransformPhase } from '../transforms/history-text.js'

export type NarrativeSampleSelection =
  | {
      kind: 'tail'
      count: number
      throughNodeId?: string
    }
  | {
      kind: 'range'
      afterNodeId?: string
      throughNodeId?: string
    }

export type NarrativeSampleRequest = {
  timelineId: string
  branchId?: string
  selection: NarrativeSampleSelection
  maxNodes?: number
  maxCharacters?: number
}

/** Host-owned permission, never part of the Agent's sampling arguments. */
export type NarrativeReadRange = {
  timelineId: string
  branchId: string
  afterNodeId?: string
  throughNodeId: string | null
}

export type NarrativeSampleResult = {
  timelineId: string
  branchId: string
  readHeadNodeId?: string
  throughNodeId?: string
  afterNodeId?: string
  nodes: Array<NarrativeNode & {
    position: number
    text: string
  }>
  text: string
  complete: boolean
  nextBeforeNodeId?: string
  processing?: {
    phase: TextTransformPhase
    rules: Array<{ id: string; version: number }>
    diagnostics: TextTransformDiagnostic[]
  }
}

const pageLimit = 100
// ponytail: Per-read limits match the text pipeline; use explicit continuation for larger ranges.
export const defaultNarrativeSampleBudget = { maxNodes: 1_000, maxCharacters: 2_000_000 } as const
const { maxNodes: defaultMaxNodes, maxCharacters: defaultMaxCharacters } = defaultNarrativeSampleBudget

export type NarrativeSampler = {
  sample(request: NarrativeSampleRequest, signal?: AbortSignal): Promise<NarrativeSampleResult>
}

export function createNarrativeSampler(store: NarrativeStore, allowedRange?: NarrativeReadRange): NarrativeSampler {
  const access = allowedRange && { ...allowedRange }
  return {
    sample: (request, signal) => sampleNarrative(store, structuredClone(request), signal, access),
  }
}

async function sampleNarrative(
  store: NarrativeStore,
  request: NarrativeSampleRequest,
  signal?: AbortSignal,
  access?: NarrativeReadRange,
): Promise<NarrativeSampleResult> {
  const maxNodes = request.maxNodes === undefined ? defaultMaxNodes : request.maxNodes
  const maxCharacters = request.maxCharacters === undefined ? defaultMaxCharacters : request.maxCharacters
  validateBudget(maxNodes, maxCharacters)
  validateSelection(request.selection)
  signal?.throwIfAborted()

  if (access) {
    await assertReadRange(store, request, access, signal)
    if (access.throughNodeId === null) {
      return { timelineId: access.timelineId, branchId: access.branchId, nodes: [], text: '', complete: true }
    }
    request = {
      ...request, branchId: access.branchId,
      selection: {
        ...request.selection,
        throughNodeId: request.selection.throughNodeId ?? access.throughNodeId,
        ...(request.selection.kind === 'range' ? { afterNodeId: request.selection.afterNodeId ?? access.afterNodeId } : {}),
      },
    }
  }
  let page = await store.getPage({
    timelineId: request.timelineId,
    ...(request.branchId ? { branchId: request.branchId } : {}),
    ...(request.selection.throughNodeId ? { cursor: request.selection.throughNodeId } : {}),
    limit: request.selection.kind === 'tail' ? Math.min(request.selection.count, pageLimit) : pageLimit,
  })
  signal?.throwIfAborted()
  const { timeline, branch } = page
  const throughNodeId = request.selection.throughNodeId ?? branch.headNodeId
  const afterNodeId = request.selection.kind === 'range' ? request.selection.afterNodeId : access?.afterNodeId
  const selected: NarrativeNode[] = []
  let characters = 0
  let visited = 0
  let foundAfter = !afterNodeId || request.selection.kind === 'tail'
  let finished = false
  let nextBeforeNodeId: string | undefined
  // Keep only the budgeted tail while checking the requested ancestor, not the entire history.
  while (true) {
    for (const node of [...page.nodes].reverse()) {
      if (node.id === afterNodeId) {
        foundAfter = true
        finished = true
        break
      }
      visited++
      const size = node.body.raw.length + (selected.length ? 2 : 0)
      if (!nextBeforeNodeId && selected.length < maxNodes && characters + size <= maxCharacters) {
        selected.push(node)
        characters += size
      } else if (!nextBeforeNodeId) {
        if (!selected.length) throw new Error('Narrative sample maxCharacters is smaller than a single node')
        nextBeforeNodeId = node.id
      }
      if (request.selection.kind === 'tail' && visited === request.selection.count) {
        finished = true
        break
      }
    }
    if (finished || !page.nextCursor) break
    signal?.throwIfAborted()
    page = await store.getPage({
      timelineId: timeline.id, branchId: branch.id, cursor: page.nextCursor,
      limit: request.selection.kind === 'tail'
        ? Math.min(request.selection.count - visited, pageLimit) : pageLimit,
    })
    signal?.throwIfAborted()
  }
  if (!foundAfter) throw new Error(`Narrative range start is not an ancestor of ${throughNodeId ?? 'empty branch'}: ${afterNodeId}`)
  const nodes = selected.reverse().map((node, index) => ({
    id: node.id,
    timelineId: timeline.id,
    ...(node.parentNodeId ? { parentNodeId: node.parentNodeId } : {}),
    stateRevisionId: node.stateRevisionId,
    body: node.body,
    ...(node.source ? { source: node.source } : {}),
    createdAt: node.createdAt,
    position: index + 1,
    text: node.body.raw,
  }))

  return {
    timelineId: timeline.id,
    branchId: branch.id,
    readHeadNodeId: access?.throughNodeId ?? branch.headNodeId,
    throughNodeId,
    ...(afterNodeId ? { afterNodeId } : {}),
    nodes,
    text: nodes.map(node => node.body.raw).join('\n\n'),
    complete: nextBeforeNodeId === undefined,
    ...(nextBeforeNodeId ? { nextBeforeNodeId } : {}),
  }
}

async function assertReadRange(
  store: NarrativeStore, request: NarrativeSampleRequest, access: NarrativeReadRange, signal?: AbortSignal,
): Promise<void> {
  if (request.timelineId !== access.timelineId || (request.branchId !== undefined && request.branchId !== access.branchId)) {
    throw readRangeError()
  }
  const through = request.selection.throughNodeId ?? access.throughNodeId
  const after = request.selection.kind === 'range' ? request.selection.afterNodeId ?? access.afterNodeId : undefined
  if (access.throughNodeId === null) {
    if (through || after) throw readRangeError()
    return
  }
  let foundThrough = false
  let foundAfter = after === undefined
  let foundBoundary = access.afterNodeId === undefined
  let cursor: string | undefined = access.throughNodeId
  // ponytail: Prove ancestry through paged reads until the store offers an indexed bounded-range query.
  while (cursor) {
    signal?.throwIfAborted()
    const page = await store.getPage({ timelineId: access.timelineId, branchId: access.branchId, cursor, limit: pageLimit })
    signal?.throwIfAborted()
    for (const node of [...page.nodes].reverse()) {
      if (node.id === through) foundThrough = true
      if (node.id === after && foundThrough) foundAfter = true
      if (node.id === access.afterNodeId) {
        foundBoundary = true
        cursor = undefined
        break
      }
    }
    if (foundBoundary && access.afterNodeId !== undefined) break
    cursor = page.nextCursor
  }
  if (!foundBoundary) throw new Error('Narrative host read boundary is not on the selected branch')
  if (!foundThrough || !foundAfter
    || (request.selection.throughNodeId !== undefined && through === access.afterNodeId && request.selection.kind === 'tail')) throw readRangeError()
}

function readRangeError(): Error & { code: string } {
  return Object.assign(new Error('Narrative request is outside the host-authorized range'), { code: 'narrative.read_out_of_range' })
}

function validateBudget(maxNodes: number, maxCharacters: number): void {
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > defaultMaxNodes) {
    throw new Error(`Narrative sample maxNodes must be a positive integer up to ${defaultMaxNodes}`)
  }
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1 || maxCharacters > defaultMaxCharacters) {
    throw new Error(`Narrative sample maxCharacters must be a positive integer up to ${defaultMaxCharacters}`)
  }
}

function validateSelection(selection: NarrativeSampleSelection): void {
  if (!selection || typeof selection !== 'object') throw new Error('Narrative selection must be an object')
  for (const name of ['throughNodeId', 'afterNodeId'] as const) {
    if (name in selection) {
      const value = (selection as unknown as Record<string, unknown>)[name]
      if (value !== undefined && (typeof value !== 'string' || !value.trim())) {
        throw new Error(`Narrative ${name} must be a nonempty node ID`)
      }
    }
  }
  if (selection.kind === 'tail') {
    if (!Number.isSafeInteger(selection.count) || selection.count < 1) {
      throw new Error('Narrative tail count must be a positive integer')
    }
    return
  }
  if (selection.kind !== 'range') throw new Error('Unsupported Narrative sample selection')
  if (!selection.afterNodeId && !selection.throughNodeId) {
    throw new Error('Narrative range requires afterNodeId or throughNodeId')
  }
}
