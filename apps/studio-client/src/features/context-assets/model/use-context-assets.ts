import { useState } from 'react'
import type { ClientJsonValue } from '@loom-studio/client-bridge'
import type { ContextAssetNode, Session } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import {
  addContextAssetNode,
  deleteContextAssetNode,
  duplicateContextAssetNode,
  moveContextAssetNode,
  updateContextAssetNode,
} from './tree-ops.js'
import { normalizeContextAssets } from './context-asset-normalization.js'
import { findContextAssetNode } from './context-asset-tree.js'
import { readDemoProjectionOrderProfile } from './projection-order-profile.js'

type UseContextAssetsInput = {
  api?: StudioApi
  initialNodes: ContextAssetNode[]
  initialSelectedId: string
  workspaceId?: string
}

export function useContextAssets(input: UseContextAssetsInput) {
  const [nodes, setNodes] = useState<ContextAssetNode[]>(normalizeContextAssets(input.initialNodes))
  const [selectedId, setSelectedId] = useState(input.initialSelectedId)

  function addContextAsset(parentId: string) {
    const mutation = addContextAssetNode(nodes, parentId)
    setNodes(mutation.nodes)
    if (mutation.selectedId) setSelectedId(mutation.selectedId)
    const asset = findContextAssetNode(mutation.nodes, mutation.selectedId)
    if (asset) persistCreateContextAsset(input.api, input.workspaceId, parentId, 'inside', asset, setNodes)
  }

  function updateContextAsset(id: string, partial: Partial<ContextAssetNode>) {
    setNodes(current => {
      const next = updateContextAssetNode(current, id, partial)
      const updatedNode = findContextAssetNode(next, id)
      if (updatedNode) persistContextAsset(input.api, input.workspaceId, updatedNode)
      return next
    })
  }

  function moveContextAsset(draggedId: string, targetId: string, position: 'before' | 'inside' | 'after') {
    setNodes(current => moveContextAssetNode(current, draggedId, targetId, position))
    persistMoveContextAsset(input.api, input.workspaceId, draggedId, targetId, position, setNodes)
  }

  function duplicateContextAsset(id: string) {
    const mutation = duplicateContextAssetNode(nodes, id)
    setNodes(mutation.nodes)
    if (mutation.selectedId) setSelectedId(mutation.selectedId)
    const asset = findContextAssetNode(mutation.nodes, mutation.selectedId)
    if (asset) persistCreateContextAsset(input.api, input.workspaceId, id, 'after', asset, setNodes)
  }

  function deleteContextAsset(id: string) {
    const mutation = deleteContextAssetNode(nodes, id, selectedId)
    setNodes(mutation.nodes)
    if (mutation.selectedId) setSelectedId(mutation.selectedId)
    persistDeleteContextAsset(input.api, input.workspaceId, id, setNodes)
  }

  function readProjectionOrderProfile(session: Session | undefined): ClientJsonValue | undefined {
    return readDemoProjectionOrderProfile(nodes, session)
  }

  return {
    nodes,
    setNodes,
    selectedId,
    setSelectedId,
    updateContextAsset,
    moveContextAsset,
    addContextAsset,
    duplicateContextAsset,
    deleteContextAsset,
    readProjectionOrderProfile,
  }
}

function persistContextAsset(api: StudioApi | undefined, workspaceId: string | undefined, node: ContextAssetNode): void {
  if (!api || !workspaceId) return
  void api.promptWorkspaces.updateAsset(jsonObject({
    workspaceId,
    assetId: node.id,
    body: node.body,
    capabilities: node.capabilities as ClientJsonValue | undefined,
    enabled: node.enabled,
    label: node.label,
    meta: node.meta,
  })).catch(error => {
    console.error('Failed to persist prompt asset', error)
  })
}

function persistCreateContextAsset(
  api: StudioApi | undefined,
  workspaceId: string | undefined,
  targetAssetId: string,
  position: 'before' | 'inside' | 'after',
  asset: ContextAssetNode,
  setNodes: (nodes: ContextAssetNode[]) => void,
): void {
  if (!api || !workspaceId) return
  void api.promptWorkspaces.createAsset(jsonObject({
    workspaceId,
    targetAssetId,
    position,
    asset: asset as ClientJsonValue,
  })).then(result => {
    setNodes(normalizeContextAssets(result.workspace.contextAssets))
  }).catch(error => {
    console.error('Failed to create prompt asset', error)
  })
}

function persistMoveContextAsset(
  api: StudioApi | undefined,
  workspaceId: string | undefined,
  assetId: string,
  targetAssetId: string,
  position: 'before' | 'inside' | 'after',
  setNodes: (nodes: ContextAssetNode[]) => void,
): void {
  if (!api || !workspaceId) return
  void api.promptWorkspaces.moveAsset(jsonObject({
    workspaceId,
    assetId,
    targetAssetId,
    position,
  })).then(result => {
    setNodes(normalizeContextAssets(result.workspace.contextAssets))
  }).catch(error => {
    console.error('Failed to move prompt asset', error)
  })
}

function persistDeleteContextAsset(
  api: StudioApi | undefined,
  workspaceId: string | undefined,
  assetId: string,
  setNodes: (nodes: ContextAssetNode[]) => void,
): void {
  if (!api || !workspaceId) return
  void api.promptWorkspaces.deleteAsset(jsonObject({
    workspaceId,
    assetId,
  })).then(result => {
    setNodes(normalizeContextAssets(result.workspace.contextAssets))
  }).catch(error => {
    console.error('Failed to delete prompt asset', error)
  })
}

function jsonObject(value: Record<string, ClientJsonValue | undefined>): { [key: string]: ClientJsonValue } {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as { [key: string]: ClientJsonValue }
}
