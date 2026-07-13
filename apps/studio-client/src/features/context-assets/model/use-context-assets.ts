import { useRef, useState } from 'react'
import type { ClientJsonValue } from '@loom-studio/client-bridge'
import type { ContextAssetNode, PromptWorkspace, Session, UpdatePromptWorkspaceResult } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { Translator } from '../../../shared/i18n/index.js'
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
import type { ContextAssetUpdate } from './projection-workbench.js'

type UseContextAssetsInput = {
  api?: StudioApi
  initialNodes: ContextAssetNode[]
  initialSelectedId: string
  onWorkspaceChange?(workspace: PromptWorkspace): void
  recordEdit(entry: {
    label: string
    changesetId: string
    anchor?: { documentId: string; subjectId?: string }
  }): void
  runAction(action: () => Promise<void>): Promise<void>
  t: Translator
  workspaceId?: string
}

export function useContextAssets(input: UseContextAssetsInput) {
  const initialNodes = normalizeContextAssets(input.initialNodes)
  const [nodes, setNodeState] = useState<ContextAssetNode[]>(initialNodes)
  const [selectedId, setSelectedId] = useState(input.initialSelectedId)
  const nodesRef = useRef(initialNodes)
  const persistedNodesRef = useRef(initialNodes)
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve())

  function applyDraftNodes(next: ContextAssetNode[]) {
    nodesRef.current = next
    setNodeState(next)
  }

  function setNodes(next: ContextAssetNode[]) {
    const normalized = normalizeContextAssets(next)
    persistedNodesRef.current = normalized
    applyDraftNodes(normalized)
  }

  function applyWorkspace(workspace: PromptWorkspace) {
    setNodes(workspace.contextAssets)
    input.onWorkspaceChange?.(workspace)
  }

  function enqueueMutation(action: () => Promise<void>): Promise<void> {
    const pending = mutationQueueRef.current.then(() => input.runAction(action))
    mutationQueueRef.current = pending.catch(() => undefined)
    return pending
  }

  function previewContextAsset(id: string, partial: Partial<ContextAssetNode>) {
    applyDraftNodes(updateContextAssetNode(nodesRef.current, id, partial))
  }

  function updateContextAsset(id: string, partial: Partial<ContextAssetNode>): Promise<void> {
    if (!input.api || !input.workspaceId) {
      persistedNodesRef.current = nodesRef.current
      return Promise.resolve()
    }

    return enqueueMutation(async () => {
      const next = updateContextAssetNode(persistedNodesRef.current, id, partial)
      const previousNode = findContextAssetNode(persistedNodesRef.current, id)
      const nextNode = findContextAssetNode(next, id)
      if (!previousNode || !nextNode || samePromptAssetPatch(previousNode, nextNode)) return

      try {
        await commitContextAssetMutation({
          mutate: () => input.api!.promptWorkspaces.updateAsset(jsonObject({
            workspaceId: input.workspaceId,
            ...readPromptAssetPatch(nextNode),
          })),
          applyWorkspace,
          recordEdit: input.recordEdit,
          entry: {
            label: input.t('history.context.update'),
            anchor: { documentId: input.workspaceId!, subjectId: id },
          },
        })
      } catch (error) {
        applyDraftNodes(persistedNodesRef.current)
        throw error
      }
    })
  }

  function updateContextAssets(updates: ContextAssetUpdate[]): Promise<void> {
    if (updates.length === 0) return Promise.resolve()
    if (!input.api || !input.workspaceId) {
      const next = updates.reduce((current, update) => updateContextAssetNode(current, update.id, update.partial), nodesRef.current)
      setNodes(next)
      return Promise.resolve()
    }

    return enqueueMutation(async () => {
      const next = updates.reduce((current, update) => updateContextAssetNode(current, update.id, update.partial), persistedNodesRef.current)
      const changedNodes = updates.flatMap(update => {
        const previousNode = findContextAssetNode(persistedNodesRef.current, update.id)
        const nextNode = findContextAssetNode(next, update.id)
        return previousNode && nextNode && !samePromptAssetPatch(previousNode, nextNode) ? [nextNode] : []
      })
      if (changedNodes.length === 0) return

      try {
        await commitContextAssetMutation({
          mutate: () => input.api!.promptWorkspaces.updateAssets(jsonObject({
            workspaceId: input.workspaceId,
            updates: changedNodes.map(node => readPromptAssetPatch(node)) as ClientJsonValue,
          })),
          applyWorkspace,
          recordEdit: input.recordEdit,
          entry: {
            label: input.t('history.context.reorder'),
            anchor: { documentId: input.workspaceId!, subjectId: updates[0]?.id },
          },
        })
      } catch (error) {
        applyDraftNodes(persistedNodesRef.current)
        throw error
      }
    })
  }

  function addContextAsset(parentId: string): Promise<void> {
    if (!input.api || !input.workspaceId) {
      const mutation = addContextAssetNode(nodesRef.current, parentId)
      setNodes(mutation.nodes)
      if (mutation.selectedId) setSelectedId(mutation.selectedId)
      return Promise.resolve()
    }

    return enqueueMutation(async () => {
      const mutation = addContextAssetNode(persistedNodesRef.current, parentId)
      const asset = findContextAssetNode(mutation.nodes, mutation.selectedId)
      if (!asset || !mutation.selectedId) return
      const result = await input.api!.promptWorkspaces.createAsset(jsonObject({
        workspaceId: input.workspaceId,
        targetAssetId: parentId,
        position: 'inside',
        asset: asset as unknown as ClientJsonValue,
      }))
      applyWorkspace(result.workspace)
      setSelectedId(mutation.selectedId)
      input.recordEdit({
        label: input.t('history.context.create'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: input.workspaceId!, subjectId: mutation.selectedId },
      })
    })
  }

  function moveContextAsset(draggedId: string, targetId: string, position: 'before' | 'inside' | 'after'): Promise<void> {
    if (!input.api || !input.workspaceId) {
      setNodes(moveContextAssetNode(nodesRef.current, draggedId, targetId, position))
      return Promise.resolve()
    }

    return enqueueMutation(async () => {
      const next = moveContextAssetNode(persistedNodesRef.current, draggedId, targetId, position)
      if (next === persistedNodesRef.current) return
      const result = await input.api!.promptWorkspaces.moveAsset(jsonObject({
        workspaceId: input.workspaceId,
        assetId: draggedId,
        targetAssetId: targetId,
        position,
      }))
      applyWorkspace(result.workspace)
      input.recordEdit({
        label: input.t('history.context.move'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: input.workspaceId!, subjectId: draggedId },
      })
    })
  }

  function duplicateContextAsset(id: string): Promise<void> {
    if (!input.api || !input.workspaceId) {
      const mutation = duplicateContextAssetNode(nodesRef.current, id)
      setNodes(mutation.nodes)
      if (mutation.selectedId) setSelectedId(mutation.selectedId)
      return Promise.resolve()
    }

    return enqueueMutation(async () => {
      const mutation = duplicateContextAssetNode(persistedNodesRef.current, id)
      const asset = findContextAssetNode(mutation.nodes, mutation.selectedId)
      if (!asset || !mutation.selectedId) return
      const result = await input.api!.promptWorkspaces.createAsset(jsonObject({
        workspaceId: input.workspaceId,
        targetAssetId: id,
        position: 'after',
        asset: asset as unknown as ClientJsonValue,
      }))
      applyWorkspace(result.workspace)
      setSelectedId(mutation.selectedId)
      input.recordEdit({
        label: input.t('history.context.duplicate'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: input.workspaceId!, subjectId: mutation.selectedId },
      })
    })
  }

  function deleteContextAsset(id: string): Promise<void> {
    if (!input.api || !input.workspaceId) {
      const mutation = deleteContextAssetNode(nodesRef.current, id, selectedId)
      setNodes(mutation.nodes)
      if (mutation.selectedId) setSelectedId(mutation.selectedId)
      return Promise.resolve()
    }

    return enqueueMutation(async () => {
      const mutation = deleteContextAssetNode(persistedNodesRef.current, id, selectedId)
      if (mutation.nodes === persistedNodesRef.current) return
      const result = await input.api!.promptWorkspaces.deleteAsset(jsonObject({
        workspaceId: input.workspaceId,
        assetId: id,
      }))
      applyWorkspace(result.workspace)
      if (mutation.selectedId) setSelectedId(mutation.selectedId)
      input.recordEdit({
        label: input.t('history.context.delete'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: input.workspaceId!, subjectId: id },
      })
    })
  }

  function readProjectionOrderProfile(session: Session | undefined): ClientJsonValue | undefined {
    return readDemoProjectionOrderProfile(nodes, session)
  }

  return {
    nodes,
    setNodes,
    selectedId,
    setSelectedId,
    previewContextAsset,
    updateContextAsset,
    updateContextAssets,
    moveContextAsset,
    addContextAsset,
    duplicateContextAsset,
    deleteContextAsset,
    readProjectionOrderProfile,
  }
}

export async function commitContextAssetMutation(input: {
  applyWorkspace(workspace: PromptWorkspace): void
  entry: {
    label: string
    anchor?: { documentId: string; subjectId?: string }
  }
  mutate(): Promise<UpdatePromptWorkspaceResult>
  recordEdit(entry: {
    label: string
    changesetId: string
    anchor?: { documentId: string; subjectId?: string }
  }): void
}): Promise<UpdatePromptWorkspaceResult> {
  const result = await input.mutate()
  input.applyWorkspace(result.workspace)
  input.recordEdit({ ...input.entry, changesetId: result.mutation.changesetId })
  return result
}

function readPromptAssetPatch(node: ContextAssetNode): { [key: string]: ClientJsonValue } {
  return jsonObject({
    assetId: node.id,
    body: node.body,
    capabilities: node.capabilities as ClientJsonValue | undefined,
    enabled: node.enabled,
    label: node.label,
    meta: node.meta,
    orderList: node.orderList,
    skeletonPatch: node.skeletonPatch as ClientJsonValue | undefined,
    slotRanks: node.slotRanks as ClientJsonValue | undefined,
  })
}

function samePromptAssetPatch(left: ContextAssetNode, right: ContextAssetNode): boolean {
  return JSON.stringify(readPromptAssetPatch(left)) === JSON.stringify(readPromptAssetPatch(right))
}

function jsonObject(value: Record<string, ClientJsonValue | undefined>): { [key: string]: ClientJsonValue } {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as { [key: string]: ClientJsonValue }
}
