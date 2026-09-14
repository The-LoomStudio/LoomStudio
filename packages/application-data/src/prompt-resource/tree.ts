import type { JsonObject, JsonValue } from '@loom-studio/shared'
import {
  PromptResourceStoreError,
  type PromptResourceKind,
  type PromptResourceNode,
  type PromptResourceNodeDraft,
  type PromptResourceNodeKind,
  type PromptResourceNodePatch,
  type PromptResourceTreeNode,
} from './types.js'

export const defaultPageLimit = 100
export const maximumPageLimit = 500
export const containerNodeKinds = new Set(['module', 'folder', 'message', 'slot', 'virtual'])
export const nonContainerNodeKinds = new Set(['entry', 'script'])

export type NodeRow = {
  id: string
  resource_id: string
  parent_id: string | null
  order_index: number
  kind: string
  category: string | null
  label: string
  meta: string | null
  enabled: number | null
  body: string | null
  capabilities_json: string | null
  extra_json: string
  created_at: string
  updated_at: string
}

export type ResourceRow = {
  id: string
  resource_kind: string
  root_node_id: string
  label: string
  version: number
  metadata_json: string
  created_at: string
  updated_at: string
  tombstoned: number
  deleted_at: string | null
  deleted_by_json: string | null
  delete_reason: string | null
}

export type RevisionRow = {
  resource_id: string
  resource_version: number
  node_id: string
  operation: 'create' | 'update' | 'move' | 'delete'
  before_json: string | null
  after_json: string | null
  changeset_id: string
  created_at: string
  created_by_json: string
}

export type HeaderState = {
  label: string
  metadata: JsonObject
  tombstoned: boolean
  deletedAt?: string
  deletedBy?: JsonValue
  deleteReason?: string
}

export type HeaderRevisionRow = {
  resource_id: string
  resource_version: number
  before_json: string | null
  after_json: string | null
  changeset_id: string
  created_at: string
  created_by_json: string
}

export type StoredNode = PromptResourceNode

export function flattenTree(root: PromptResourceTreeNode, resourceId: string, timestamp: string): Map<string, StoredNode> {
  const nodes = new Map<string, StoredNode>()
  const visit = (node: PromptResourceTreeNode, parentId: string | undefined, orderIndex: number): void => {
    if (nodes.has(node.id)) throw new PromptResourceStoreError('prompt_resource.node_conflict', `Prompt resource node already exists: ${node.id}`)
    const stored: StoredNode = { ...node, resourceId, ...(parentId ? { parentId } : {}), orderIndex, createdAt: timestamp, updatedAt: timestamp }
    delete (stored as { children?: unknown }).children
    nodes.set(node.id, stored)
    for (const [index, child] of (node.children ?? []).entries()) visit(child, node.id, index)
  }
  visit(root, undefined, 0)
  return nodes
}

export function toTree(root: StoredNode, nodes: Map<string, StoredNode>): PromptResourceTreeNode {
  const children = [...nodes.values()].filter(node => node.parentId === root.id).sort(compareOrder).map(node => toTree(node, nodes))
  const tree: PromptResourceTreeNode = {
    id: root.id,
    kind: root.kind,
    label: root.label,
    ...(root.category === undefined ? {} : { category: root.category }),
    ...(root.meta === undefined ? {} : { meta: root.meta }),
    ...(root.enabled === undefined ? {} : { enabled: root.enabled }),
    ...(root.body === undefined ? {} : { body: root.body }),
    ...(root.capabilities === undefined ? {} : { capabilities: root.capabilities }),
    ...(Object.keys(root.extra ?? {}).length === 0 ? {} : { extra: root.extra }),
    ...(children.length === 0 ? {} : { children }),
  }
  return tree
}

export function nodeFromRow(row: NodeRow): StoredNode {
  return {
    id: row.id,
    resourceId: row.resource_id,
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
    orderIndex: row.order_index,
    kind: readNodeKind(row.kind),
    ...(row.category ? { category: readResourceKind(row.category) } : {}),
    label: row.label,
    ...(row.meta !== null ? { meta: row.meta } : {}),
    ...(row.enabled !== null ? { enabled: Boolean(row.enabled) } : {}),
    ...(row.body !== null ? { body: row.body } : {}),
    ...(row.capabilities_json !== null ? { capabilities: parseJson(row.capabilities_json, 'capabilities') } : {}),
    extra: parseObject(row.extra_json, 'extra'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function nodeFromDraft(draft: PromptResourceNodeDraft, resourceId: string, parentId: string, orderIndex: number, timestamp: string): StoredNode {
  return { ...draft, resourceId, parentId, orderIndex, createdAt: timestamp, updatedAt: timestamp }
}

export function applyNodePatch(node: StoredNode, patch: PromptResourceNodePatch): StoredNode {
  const candidate: StoredNode = { ...node, updatedAt: node.updatedAt }
  if (patch.label !== undefined) candidate.label = patch.label.trim()
  if (patch.category !== undefined) {
    if (patch.category === null) delete candidate.category
    else candidate.category = patch.category
  }
  if (patch.meta !== undefined) {
    if (patch.meta === null) delete candidate.meta
    else candidate.meta = patch.meta
  }
  if (patch.enabled !== undefined) {
    if (patch.enabled === null) delete candidate.enabled
    else candidate.enabled = patch.enabled
  }
  if (patch.body !== undefined) {
    if (patch.body === null) delete candidate.body
    else candidate.body = patch.body
  }
  if (patch.capabilities !== undefined) {
    if (patch.capabilities === null) delete candidate.capabilities
    else candidate.capabilities = patch.capabilities
  }
  if (patch.extra !== undefined) {
    if (patch.extra === null) {
      if (Object.keys(candidate.extra ?? {}).length > 0) delete candidate.extra
    }
    else candidate.extra = patch.extra
  }
  return candidate
}

export function validateTree(resourceId: string, nodes: Map<string, StoredNode>, rootId: string): void {
  const roots = [...nodes.values()].filter(node => !node.parentId)
  if (roots.length !== 1 || roots[0]?.id !== rootId) throw new PromptResourceStoreError('prompt_resource.root_invalid', `Prompt resource must have exactly one root: ${resourceId}`)
  for (const node of nodes.values()) {
    validateNodeShape(node)
    validateCategory(node.category)
    if (node.resourceId !== resourceId) throw new PromptResourceStoreError('prompt_resource.ownership', `Node belongs to another resource: ${node.id}`)
    if (node.parentId) {
      const parent = nodes.get(node.parentId)
      if (!parent) throw new PromptResourceStoreError('prompt_resource.parent_not_found', `Prompt resource parent not found: ${node.parentId}`)
      assertContainer(parent)
      if (isDescendant(nodes, node.id, node.parentId)) throw new PromptResourceStoreError('prompt_resource.cycle', `Prompt resource tree contains a cycle: ${node.id}`)
    }
  }
}

export function validateNodeShape(node: Pick<PromptResourceNode, 'id' | 'kind' | 'label' | 'orderIndex'>): void {
  validateId(node.id, 'nodeId')
  if (typeof node.kind !== 'string' || !node.kind || node.kind.trim() !== node.kind) {
    throw new PromptResourceStoreError('prompt_resource.kind_invalid', `Prompt resource node kind is invalid: ${node.kind}`)
  }
  if (typeof node.label !== 'string' || !node.label.trim()) throw new PromptResourceStoreError('prompt_resource.label_invalid', `Prompt resource node label must be a non-empty string: ${node.id}`)
  validateOrderIndex(node.orderIndex)
}

export function validateNodeDraft(node: PromptResourceNodeDraft): void {
  validateNodeShape({ id: node.id, kind: node.kind, label: node.label, orderIndex: node.orderIndex ?? 0 })
  validateCategory(node.category)
  if (node.extra !== undefined) validateJsonObject(node.extra, 'extra')
  if (node.capabilities !== undefined) stringifyJson(node.capabilities, 'capabilities')
}

export function assertContainer(node: StoredNode): void {
  if (nonContainerNodeKinds.has(node.kind)) throw new PromptResourceStoreError('prompt_resource.parent_invalid', `Node cannot contain children: ${node.id}`)
}

export function validateId(id: unknown, label: string, optional = false): void {
  if (id === undefined && optional) return
  if (typeof id !== 'string' || !id || id.trim() !== id) throw new PromptResourceStoreError('prompt_resource.id_invalid', `${label} must be a non-empty trimmed string`)
}

export function validateOrderIndex(orderIndex: number): void {
  if (!Number.isInteger(orderIndex) || orderIndex < 0) throw new PromptResourceStoreError('prompt_resource.order_invalid', 'Prompt resource orderIndex must be a non-negative integer')
}

export function validateResourceKind(kind: string): asserts kind is PromptResourceKind {
  if (typeof kind !== 'string' || !kind || kind.trim() !== kind) {
    throw new PromptResourceStoreError('prompt_resource.resource_kind_invalid', `Prompt resource kind is invalid: ${kind}`)
  }
}

export function validateCategory(category: string | null | undefined): void {
  if (category !== undefined && category !== null) validateResourceKind(category)
}

export function validateJsonObject(value: JsonObject | undefined, label: string): void {
  if (value === undefined || value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new PromptResourceStoreError('prompt_resource.json_invalid', `${label} must be a JSON object`)
  }
}

export function readResourceKind(kind: string): PromptResourceKind {
  validateResourceKind(kind)
  return kind
}

export function readNodeKind(kind: string): PromptResourceNodeKind {
  if (typeof kind !== 'string' || !kind || kind.trim() !== kind) {
    throw new PromptResourceStoreError('prompt_resource.kind_invalid', `Prompt resource node kind is invalid: ${kind}`)
  }
  return kind as PromptResourceNodeKind
}

export function nextSiblingOrder(nodes: Map<string, StoredNode>, parentId: string): number {
  return Math.max(-1, ...[...nodes.values()].filter(node => node.parentId === parentId).map(node => node.orderIndex)) + 1
}

export function requireNode(nodes: Map<string, StoredNode>, id: string): StoredNode {
  validateId(id, 'nodeId')
  const node = nodes.get(id)
  if (!node) throw new PromptResourceStoreError('prompt_resource.node_not_found', `Prompt resource node not found: ${id}`)
  return node
}

export function collectSubtree(nodes: Map<string, StoredNode>, rootId: string): string[] {
  const result: string[] = []
  const visit = (id: string): void => {
    result.push(id)
    for (const child of nodes.values()) if (child.parentId === id) visit(child.id)
  }
  visit(rootId)
  return result
}

export function nodeDepth(nodes: Map<string, StoredNode>, id: string): number {
  let depth = 0
  let current = nodes.get(id)
  while (current?.parentId) {
    depth += 1
    current = nodes.get(current.parentId)
  }
  return depth
}

export function isDescendant(nodes: Map<string, StoredNode>, ancestorId: string, possibleDescendantId: string): boolean {
  if (ancestorId === possibleDescendantId) return true
  let current = nodes.get(possibleDescendantId)
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true
    current = nodes.get(current.parentId)
  }
  return false
}

export function cloneNodeMap(nodes: Map<string, StoredNode>): Map<string, StoredNode> {
  return new Map([...nodes.entries()].map(([id, node]) => [id, structuredClone(node) as StoredNode]))
}

export function sameJson(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right))
  } catch {
    return false
  }
}

export function canonicalJson(value: unknown, seen = new Set<unknown>()): unknown {
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) throw new Error('cyclic JSON')
  seen.add(value)
  if (Array.isArray(value)) {
    const result = value.map(item => canonicalJson(item, seen))
    seen.delete(value)
    return result
  }
  const object = value as Record<string, unknown>
  const result = Object.fromEntries(Object.keys(object).sort().map(key => [key, canonicalJson(object[key], seen)]))
  seen.delete(value)
  return result
}

export function sameNodeValue(left: StoredNode, right: StoredNode): boolean {
  return sameJson(left, right)
}

export function compareOrder(left: StoredNode, right: StoredNode): number {
  return left.orderIndex - right.orderIndex || left.id.localeCompare(right.id)
}

export function parseJson(value: string | undefined, label: string): JsonValue {
  if (!value) throw new PromptResourceStoreError('prompt_resource.json_invalid', `${label} is missing`)
  try { return JSON.parse(value) as JsonValue } catch { throw new PromptResourceStoreError('prompt_resource.json_invalid', `${label} is invalid JSON`) }
}

export function parseObject(value: string | undefined, label: string): JsonObject {
  const parsed = parseJson(value, label)
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new PromptResourceStoreError('prompt_resource.json_invalid', `${label} must be a JSON object`)
  return parsed as JsonObject
}

export function parseNode(value: string): StoredNode {
  const parsed = parseJson(value, 'node revision')
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new PromptResourceStoreError('prompt_resource.revision_invalid', 'Node revision must be a JSON object')
  return parsed as StoredNode
}

export function stringifyJson(value: unknown, label: string): string {
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) throw new Error('undefined')
    return serialized
  } catch {
    throw new PromptResourceStoreError('prompt_resource.json_invalid', `${label} cannot be serialized as JSON`)
  }
}

export function isPromptResourceOperation(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false
  const operation = value as Record<string, unknown>
  return operation.store === 'prompt-resources' && operation.entityType === 'prompt-resource' && typeof operation.entityId === 'string'
}
