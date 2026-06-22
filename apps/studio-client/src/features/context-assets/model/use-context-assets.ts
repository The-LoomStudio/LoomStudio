import { useState } from 'react'
import type { ClientJsonValue } from '@loom-studio/client-bridge'
import type { ContextAssetNode, Session } from '../../../entities/index.js'
import {
  addContextAssetNode,
  deleteContextAssetNode,
  duplicateContextAssetNode,
  normalizeContextAssets,
  readDemoProjectionOrderProfile,
} from './tree-ops.js'

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
    addContextAsset,
    duplicateContextAsset,
    deleteContextAsset,
    readProjectionOrderProfile,
  }
}
