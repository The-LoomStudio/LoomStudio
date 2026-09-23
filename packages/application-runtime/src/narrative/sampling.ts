import type { NarrativeNode, NarrativeStore } from '@loom-studio/application-data'

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

export type NarrativeSampleResult = {
  timelineId: string
  branchId: string
  readHeadNodeId?: string
  throughNodeId?: string
  afterNodeId?: string
  nodes: Array<{
    id: string
    parentNodeId?: string
    stateRevisionId: string
    body: NarrativeNode['body']
    source?: NarrativeNode['source']
    createdAt: string
    position: number
  }>
  text: string
  complete: boolean
  nextBeforeNodeId?: string
}

const pageLimit = 100
const defaultMaxNodes = 1_000
const defaultMaxCharacters = 2_000_000

export type NarrativeSampler = {
  sample(request: NarrativeSampleRequest): Promise<NarrativeSampleResult>
}

export function createNarrativeSampler(store: NarrativeStore): NarrativeSampler {
  return {
    sample: request => sampleNarrative(store, request),
  }
}

async function sampleNarrative(
  store: NarrativeStore,
  request: NarrativeSampleRequest,
): Promise<NarrativeSampleResult> {
  const maxNodes = request.maxNodes ?? defaultMaxNodes
  const maxCharacters = request.maxCharacters ?? defaultMaxCharacters
  validateBudget(maxNodes, maxCharacters)
  validateSelection(request.selection)

  const firstPage = await store.getPage({
    timelineId: request.timelineId,
    ...(request.branchId ? { branchId: request.branchId } : {}),
    ...(request.selection.throughNodeId ? { cursor: request.selection.throughNodeId } : {}),
    limit: 1,
  })
  const throughNodeId = request.selection.throughNodeId ?? firstPage.branch.headNodeId
  if (!throughNodeId) {
    return {
      timelineId: firstPage.timeline.id,
      branchId: firstPage.branch.id,
      readHeadNodeId: firstPage.branch.headNodeId,
      nodes: [],
      text: '',
      complete: true,
    }
  }

  const selected = await readSelection(store, request, firstPage.branch.id, throughNodeId)
  const fitted = fitNodes(selected, maxNodes, maxCharacters)
  const nodes = fitted.nodes.map((node, index) => ({
    id: node.id,
    ...(node.parentNodeId ? { parentNodeId: node.parentNodeId } : {}),
    stateRevisionId: node.stateRevisionId,
    body: node.body,
    ...(node.source ? { source: node.source } : {}),
    createdAt: node.createdAt,
    position: index + 1,
  }))

  return {
    timelineId: firstPage.timeline.id,
    branchId: firstPage.branch.id,
    readHeadNodeId: firstPage.branch.headNodeId,
    throughNodeId,
    ...(request.selection.kind === 'range' && request.selection.afterNodeId
      ? { afterNodeId: request.selection.afterNodeId }
      : {}),
    nodes,
    text: nodes.map(node => node.body.raw).join('\n\n'),
    complete: fitted.complete,
    ...(fitted.nextBeforeNodeId ? { nextBeforeNodeId: fitted.nextBeforeNodeId } : {}),
  }
}

async function readSelection(
  store: NarrativeStore,
  request: NarrativeSampleRequest,
  branchId: string,
  throughNodeId: string,
): Promise<NarrativeNode[]> {
  const { selection } = request
  const nodes: NarrativeNode[] = []
  let cursor: string | undefined = throughNodeId
  let foundAfter = selection.kind === 'range' && !selection.afterNodeId

  while (cursor) {
    const page = await store.getPage({
      timelineId: request.timelineId,
      branchId,
      cursor,
      limit: pageLimit,
    })
    nodes.unshift(...page.nodes)
    if (selection.kind === 'range' && selection.afterNodeId
      && page.nodes.some(node => node.id === selection.afterNodeId)) {
      foundAfter = true
      break
    }
    cursor = page.nextCursor
    if (selection.kind === 'tail' && nodes.length >= selection.count) break
  }

  if (selection.kind === 'tail') return nodes.slice(-selection.count)
  if (!foundAfter && selection.afterNodeId) {
    throw new Error(`Narrative range start is not an ancestor of ${throughNodeId}: ${selection.afterNodeId}`)
  }
  const startIndex = selection.afterNodeId
    ? nodes.findIndex(node => node.id === selection.afterNodeId) + 1
    : 0
  return nodes.slice(startIndex)
}

function fitNodes(
  nodes: NarrativeNode[],
  maxNodes: number,
  maxCharacters: number,
): { nodes: NarrativeNode[]; complete: boolean; nextBeforeNodeId?: string } {
  let selected = nodes
  let complete = true
  if (selected.length > maxNodes) {
    selected = selected.slice(-maxNodes)
    complete = false
  }

  let total = 0
  let firstIncluded = selected.length
  for (let index = selected.length - 1; index >= 0; index -= 1) {
    const next = selected[index]!.body.raw.length + (total > 0 ? 2 : 0)
    if (total + next > maxCharacters) {
      complete = false
      break
    }
    total += next
    firstIncluded = index
  }
  if (firstIncluded > 0) {
    if (firstIncluded === selected.length) {
      throw new Error('Narrative sample maxCharacters is smaller than a single node')
    }
    selected = selected.slice(firstIncluded)
    complete = false
  }

  return {
    nodes: selected,
    complete,
    ...(selected[0]?.parentNodeId ? { nextBeforeNodeId: selected[0].parentNodeId } : {}),
  }
}

function validateBudget(maxNodes: number, maxCharacters: number): void {
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1) throw new Error('Narrative sample maxNodes must be a positive integer')
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1) {
    throw new Error('Narrative sample maxCharacters must be a positive integer')
  }
}

function validateSelection(selection: NarrativeSampleSelection): void {
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
