import type { DocumentStore } from '@loom-studio/document-store'
import type { JsonObject, JsonValue } from '@loom-studio/shared'
import { createId, nowIso } from '@loom-studio/shared'
import { cardToSnapshot, normalizeOpening, normalizeOptionalString, normalizePreset, normalizeSettingLayer, renderMacros } from './card.js'
import { applicationDocumentTypes } from './document-types.js'
import { readDocument, toVersioned, writeDocument } from './document-store.js'
import { isObject } from './json.js'
import type {
  CardPresetInput,
  CardSourceContent,
  OpeningChatInput,
  SettingLayerInput,
} from './types.js'
import type {
  CompositionSkeletonPatch,
  PromptActivation,
  PromptCompositionCapabilities,
  PromptContribution,
  ProjectionOrderProfile,
  SourceNode,
} from './prompt-builder.js'

export type PromptWorkspaceArtifact = {
  schemaVersion: 1
  artifactId: string
  displayName: string
  description?: string
  card: {
    name: string
    userName?: string
    description?: string
    preset?: CardPresetInput
    opening?: OpeningChatInput | string
    settingLayer?: SettingLayerInput
  }
  contextAssets: PromptWorkspaceNode[]
  metadata?: JsonObject
}

export type PromptWorkspaceContent = {
  artifactId: string
  displayName: string
  description?: string
  cardId: string
  contextAssets: PromptWorkspaceNode[]
  sourceArtifactRef?: PromptWorkspaceSourceArtifactRef
  importBundle?: PromptWorkspaceImportBundle
  bindings?: PromptWorkspaceSourceBinding[]
  sourceArtifact: PromptWorkspaceArtifact
  createdAt: string
  updatedAt: string
}

export type PromptWorkspaceSourceArtifactRef = {
  artifactId: string
  displayName: string
  format: 'loom.promptWorkspace'
  importedAt: string
  schemaVersion: PromptWorkspaceArtifact['schemaVersion']
}

export type PromptWorkspaceImportBundle = {
  artifactId: string
  bindingIds: string[]
  documentIds: string[]
  id: string
  importedAt: string
  sourceArtifactRef: PromptWorkspaceSourceArtifactRef
}

export type PromptWorkspaceSourceBinding = {
  createdAt: string
  from: PromptWorkspaceBindingEndpoint
  id: string
  relationship: 'recommends'
  to: PromptWorkspaceBindingEndpoint
}

export type PromptWorkspaceBindingEndpoint = {
  documentId: string
  documentType: string
  nodeId?: string
}

export type PromptWorkspaceNode = {
  body?: string
  category?: 'preset' | 'setting' | 'logic' | 'runtime' | 'history'
  children?: PromptWorkspaceNode[]
  configRows?: Array<{ label: string; value: string }>
  enabled?: boolean
  id: string
  isSection?: boolean
  kind: 'module' | 'folder' | 'entry' | 'script' | 'virtual' | 'order'
  label: string
  meta?: string
  orderList?: string[]
  skeletonPatch?: CompositionSkeletonPatch
  slotRanks?: ProjectionOrderProfile['slotRanks']
  capabilities?: WorkspacePromptCompositionCapabilities
}

export type WorkspacePromptCompositionCapabilities = Omit<PromptCompositionCapabilities, 'activation' | 'lifecycle' | 'projection'> & {
  activation?: PromptActivation
  lifecycle?: { lifecycle: 'always' | 'conditional' | 'fresh' | string }
  projection?: {
    entryOrderHint?: number
    injectionGroupKey: string
    slotKey?: string
    slotOrderHint?: number
  }
}

export async function importWorkspaceArtifact(input: {
  artifact: PromptWorkspaceArtifact
  documents: DocumentStore
  now?: string
  workspaceId?: string
}): Promise<{
  workspace: PromptWorkspaceContent & { id: string; version: number }
  card: CardSourceContent & { id: string; version: number }
}> {
  const artifact = normalizeWorkspaceArtifact(input.artifact)
  const timestamp = input.now ?? nowIso()
  const workspaceId = input.workspaceId ?? createId('workspace')
  const sourceArtifactRef = createSourceArtifactRef(artifact, timestamp)
  const card = await writeDocument<CardSourceContent>(input.documents, {
    id: createId('card'),
    type: applicationDocumentTypes.cardSource,
    content: {
      name: artifact.card.name,
      userName: normalizeOptionalString(artifact.card.userName),
      description: artifact.card.description,
      preset: normalizePreset(artifact.card.preset),
      opening: normalizeOpening(artifact.card.opening),
      settingLayer: normalizeSettingLayer(artifact.card.settingLayer, undefined),
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    expectedVersion: 'new',
  })
  const bindings = createWorkspaceBindings({
    artifact,
    cardId: card.id,
    timestamp,
    workspaceId,
  })
  const workspace = await writeDocument<PromptWorkspaceContent>(input.documents, {
    id: workspaceId,
    type: applicationDocumentTypes.promptWorkspace,
    content: {
      artifactId: artifact.artifactId,
      displayName: artifact.displayName,
      description: artifact.description,
      cardId: card.id,
      contextAssets: artifact.contextAssets,
      sourceArtifactRef,
      importBundle: {
        id: createId('import-bundle'),
        artifactId: artifact.artifactId,
        importedAt: timestamp,
        sourceArtifactRef,
        documentIds: [workspaceId, card.id],
        bindingIds: bindings.map(binding => binding.id),
      },
      bindings,
      sourceArtifact: artifact,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    expectedVersion: 'new',
  })

  return {
    workspace: toVersioned(workspace),
    card: toVersioned(card),
  }
}

export async function getPromptWorkspace(input: {
  documents: DocumentStore
  workspaceId: string
}): Promise<PromptWorkspaceContent & { id: string; version: number }> {
  const workspace = await readDocument<PromptWorkspaceContent>(input.documents, input.workspaceId, applicationDocumentTypes.promptWorkspace)
  return toVersioned(workspace)
}

export async function updatePromptAsset(input: {
  assetId: string
  body?: string
  documents: DocumentStore
  enabled?: boolean
  label?: string
  now?: string
  workspaceId: string
}): Promise<PromptWorkspaceContent & { id: string; version: number }> {
  const workspace = await readDocument<PromptWorkspaceContent>(input.documents, input.workspaceId, applicationDocumentTypes.promptWorkspace)
  const result = updateNode(workspace.content.contextAssets, input.assetId, node => ({
    ...node,
    ...(input.body !== undefined ? { body: input.body } : {}),
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
  }))
  if (!result.found) throw new Error(`Prompt asset not found: ${input.assetId}`)

  const updated = await writeDocument<PromptWorkspaceContent>(input.documents, {
    id: workspace.id,
    type: applicationDocumentTypes.promptWorkspace,
    content: {
      ...workspace.content,
      contextAssets: result.nodes,
      updatedAt: input.now ?? nowIso(),
    },
    expectedVersion: workspace.version,
  })

  return toVersioned(updated)
}

export async function updateProjectionOrderProfile(input: {
  documents: DocumentStore
  now?: string
  orderList?: string[]
  orderNodeId: string
  projectionOrderProfile: ProjectionOrderProfile
  workspaceId: string
}): Promise<PromptWorkspaceContent & { id: string; version: number }> {
  const workspace = await readDocument<PromptWorkspaceContent>(input.documents, input.workspaceId, applicationDocumentTypes.promptWorkspace)
  const result = updateNode(workspace.content.contextAssets, input.orderNodeId, node => {
    if (node.kind !== 'order') throw new Error(`Prompt node is not an order profile: ${input.orderNodeId}`)

    return {
      ...node,
      ...(input.orderList ? { orderList: input.orderList } : {}),
      skeletonPatch: input.projectionOrderProfile.skeletonPatch,
      slotRanks: input.projectionOrderProfile.slotRanks,
    }
  })
  if (!result.found) throw new Error(`Projection order profile not found: ${input.orderNodeId}`)

  const updated = await writeDocument<PromptWorkspaceContent>(input.documents, {
    id: workspace.id,
    type: applicationDocumentTypes.promptWorkspace,
    content: {
      ...workspace.content,
      contextAssets: result.nodes,
      updatedAt: input.now ?? nowIso(),
    },
    expectedVersion: workspace.version,
  })

  return toVersioned(updated)
}

export async function exportWorkspaceArtifact(input: {
  documents: DocumentStore
  workspaceId: string
}): Promise<PromptWorkspaceArtifact> {
  const workspace = await readDocument<PromptWorkspaceContent>(input.documents, input.workspaceId, applicationDocumentTypes.promptWorkspace)
  const card = await readDocument<CardSourceContent>(input.documents, workspace.content.cardId, applicationDocumentTypes.cardSource)
  const cardContent = card.content

  return {
    schemaVersion: 1,
    artifactId: workspace.content.artifactId,
    displayName: workspace.content.displayName,
    description: workspace.content.description,
    card: {
      name: cardContent.name,
      userName: cardContent.userName,
      description: cardContent.description,
      preset: cardContent.preset,
      opening: cardContent.opening,
      settingLayer: cardContent.settingLayer,
    },
    contextAssets: workspace.content.contextAssets,
    metadata: {
      ...(workspace.content.sourceArtifact.metadata ?? {}),
      ...(workspace.content.sourceArtifactRef ? { sourceArtifactRef: workspace.content.sourceArtifactRef } : {}),
      ...(workspace.content.importBundle ? { importBundle: workspace.content.importBundle } : {}),
      ...(workspace.content.bindings ? { bindings: workspace.content.bindings } : {}),
      exportedFromWorkspaceId: workspace.id,
      exportedAt: nowIso(),
    },
  }
}

export async function readWorkspacePromptInputs(input: {
  documents: DocumentStore
  workspaceId: string
  macroContext: { user: string }
}): Promise<{
  orderProfile: ProjectionOrderProfile
  sourceNodes: SourceNode[]
  contributions: PromptContribution[]
}> {
  const workspace = await readDocument<PromptWorkspaceContent>(input.documents, input.workspaceId, applicationDocumentTypes.promptWorkspace)
  const orderProfile = readWorkspaceOrderProfile(workspace.content.contextAssets)
  const sourceNodes: SourceNode[] = []
  const contributions: PromptContribution[] = []

  collectPromptInputs({
    contributions,
    macroContext: input.macroContext,
    nodes: workspace.content.contextAssets,
    parentId: null,
    inheritedCategory: undefined,
    inheritedSourceId: undefined,
    sourceNodes,
  })

  return { orderProfile, sourceNodes, contributions }
}

export function readWorkspaceOrderProfile(nodes: PromptWorkspaceNode[]): ProjectionOrderProfile {
  const orderNode = findNode(nodes, node => node.kind === 'order')

  return {
    id: orderNode?.id ?? 'profile.workspace',
    scope: 'global',
    ...(orderNode?.skeletonPatch ? { skeletonPatch: orderNode.skeletonPatch } : {}),
    slotRanks: orderNode?.slotRanks ?? [],
  }
}

export function normalizeWorkspaceArtifact(artifact: PromptWorkspaceArtifact): PromptWorkspaceArtifact {
  if (artifact.schemaVersion !== 1) throw new Error(`Unsupported workspace artifact schemaVersion: ${artifact.schemaVersion}`)
  if (!artifact.artifactId || !artifact.displayName) throw new Error('Workspace artifact requires artifactId and displayName')
  if (!artifact.card?.name) throw new Error('Workspace artifact requires card.name')

  return {
    schemaVersion: 1,
    artifactId: artifact.artifactId,
    displayName: artifact.displayName,
    description: artifact.description,
    card: artifact.card,
    contextAssets: artifact.contextAssets ?? [],
    metadata: artifact.metadata ?? {},
  }
}

function createSourceArtifactRef(artifact: PromptWorkspaceArtifact, importedAt: string): PromptWorkspaceSourceArtifactRef {
  return {
    artifactId: artifact.artifactId,
    displayName: artifact.displayName,
    format: 'loom.promptWorkspace',
    importedAt,
    schemaVersion: artifact.schemaVersion,
  }
}

function createWorkspaceBindings(input: {
  artifact: PromptWorkspaceArtifact
  cardId: string
  timestamp: string
  workspaceId: string
}): PromptWorkspaceSourceBinding[] {
  const sourceModules = findNodes(input.artifact.contextAssets, node =>
    node.kind === 'module' && (node.category === 'setting' || node.category === 'preset'))

  return sourceModules.map(node => ({
    id: `binding.${input.workspaceId}.${node.id}`,
    relationship: 'recommends',
    createdAt: input.timestamp,
    from: {
      documentId: input.cardId,
      documentType: applicationDocumentTypes.cardSource,
    },
    to: {
      documentId: input.workspaceId,
      documentType: applicationDocumentTypes.promptWorkspace,
      nodeId: node.id,
    },
  }))
}

function collectPromptInputs(input: {
  contributions: PromptContribution[]
  inheritedCategory: PromptWorkspaceNode['category'] | undefined
  inheritedSourceId: string | undefined
  macroContext: { user: string }
  nodes: PromptWorkspaceNode[]
  parentId: string | null
  sourceNodes: SourceNode[]
}): void {
  for (const [index, node] of input.nodes.entries()) {
    const category = node.category ?? input.inheritedCategory
    const sourceId = node.kind === 'module' ? node.id : input.inheritedSourceId ?? node.id
    input.sourceNodes.push({
      id: node.id,
      sourceId,
      parentId: input.parentId,
      displayName: node.label,
      orderIndex: index + 1,
    })

    if (node.body && node.enabled !== false && node.capabilities?.projection && category) {
      const kind = readSourceKind(category)
      if (kind) {
        input.contributions.push({
          id: `workspace.${node.id}`,
          sourceRef: {
            kind,
            sourceId,
            sourceNodeId: node.id,
          },
          content: renderMacros(node.body, input.macroContext),
          capabilities: {
            content: { kind: 'text' },
            ...(node.capabilities.activation ? { activation: node.capabilities.activation } : {}),
            lifecycle: { lifecycle: 'always' },
            projection: {
              injectionGroupKey: node.capabilities.projection.injectionGroupKey,
              ...(node.capabilities.projection.slotKey ? { joinSlotKey: node.capabilities.projection.slotKey } : {}),
              ...(node.capabilities.projection.entryOrderHint !== undefined ? { entryOrderHint: node.capabilities.projection.entryOrderHint } : {}),
              ...(node.capabilities.projection.slotOrderHint !== undefined ? { slotOrderHint: node.capabilities.projection.slotOrderHint } : {}),
            },
          },
        })
      }
    }

    if (node.children) {
      collectPromptInputs({
        ...input,
        nodes: node.children,
        parentId: node.id,
        inheritedCategory: category,
        inheritedSourceId: sourceId,
      })
    }
  }
}

function readSourceKind(category: PromptWorkspaceNode['category']): PromptContribution['sourceRef']['kind'] | undefined {
  if (category === 'preset') return 'preset'
  if (category === 'setting') return 'settingLayer'
  if (category === 'runtime') return 'runtime'
  if (category === 'history') return 'narrativeChat'
  return undefined
}

function updateNode(
  nodes: PromptWorkspaceNode[],
  id: string,
  update: (node: PromptWorkspaceNode) => PromptWorkspaceNode,
): { found: boolean; nodes: PromptWorkspaceNode[] } {
  let found = false
  const nextNodes = nodes.map(node => {
    if (node.id === id) {
      found = true
      return update(node)
    }
    if (!node.children) return node
    const childResult = updateNode(node.children, id, update)
    if (!childResult.found) return node
    found = true
    return { ...node, children: childResult.nodes }
  })

  return { found, nodes: nextNodes }
}

function findNode(nodes: PromptWorkspaceNode[], predicate: (node: PromptWorkspaceNode) => boolean): PromptWorkspaceNode | undefined {
  for (const node of nodes) {
    if (predicate(node)) return node
    const child = node.children ? findNode(node.children, predicate) : undefined
    if (child) return child
  }
  return undefined
}

function findNodes(nodes: PromptWorkspaceNode[], predicate: (node: PromptWorkspaceNode) => boolean): PromptWorkspaceNode[] {
  const results: PromptWorkspaceNode[] = []
  for (const node of nodes) {
    if (predicate(node)) results.push(node)
    if (node.children) results.push(...findNodes(node.children, predicate))
  }
  return results
}

export async function readWorkspaceCardSnapshot(input: {
  documents: DocumentStore
  workspaceId: string
}): Promise<JsonObject> {
  const workspace = await readDocument<PromptWorkspaceContent>(input.documents, input.workspaceId, applicationDocumentTypes.promptWorkspace)
  const card = await readDocument<CardSourceContent>(input.documents, workspace.content.cardId, applicationDocumentTypes.cardSource)
  return cardToSnapshot(card)
}

export function isPromptWorkspaceArtifact(value: JsonValue | undefined): value is PromptWorkspaceArtifact {
  return isObject(value)
    && value.schemaVersion === 1
    && typeof value.artifactId === 'string'
    && typeof value.displayName === 'string'
    && isObject(value.card)
    && Array.isArray(value.contextAssets)
}
