import { useState } from 'react'
import type { ClientJsonValue } from '@loom-studio/client-bridge'
import type { ContextAssetNode, Session } from '../../../entities/index.js'
import {
  addContextAssetNode,
  deleteContextAssetNode,
  duplicateContextAssetNode,
  moveContextAssetNode,
  updateContextAssetNode,
} from './tree-ops.js'
import { normalizeContextAssets } from './context-asset-normalization.js'
import { readDemoProjectionOrderProfile } from './projection-order-profile.js'

type UseContextAssetsInput = {
  initialNodes: ContextAssetNode[]
  initialSelectedId: string
}

export function useContextAssets(input: UseContextAssetsInput) {
  const [nodes, setNodes] = useState<ContextAssetNode[]>(normalizeContextAssets(input.initialNodes))
  const [selectedId, setSelectedId] = useState(input.initialSelectedId)

  function addContextAsset(parentId: string) {
    const mutation = addContextAssetNode(nodes, parentId)
    setNodes(mutation.nodes)
    if (mutation.selectedId) setSelectedId(mutation.selectedId)
  }

  function updateContextAsset(id: string, partial: Partial<ContextAssetNode>) {
    setNodes(current => updateContextAssetNode(current, id, partial))
  }

  function moveContextAsset(draggedId: string, targetId: string, position: 'before' | 'inside' | 'after') {
    setNodes(current => moveContextAssetNode(current, draggedId, targetId, position))
  }

  function duplicateContextAsset(id: string) {
    const mutation = duplicateContextAssetNode(nodes, id)
    setNodes(mutation.nodes)
    if (mutation.selectedId) setSelectedId(mutation.selectedId)
  }

  function deleteContextAsset(id: string) {
    const mutation = deleteContextAssetNode(nodes, id, selectedId)
    setNodes(mutation.nodes)
    if (mutation.selectedId) setSelectedId(mutation.selectedId)
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
