import type { WorkspaceEntry, WorkspaceRevision } from '@loom-studio/application-data'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import type { RuntimeRequestContext, PreparedBlobStorageWrite } from '../types.js'
import { narrativeWriteContext, requireNarratives } from './context.js'

// Match the Blob Store read budget so every accepted file remains readable and portable.
export const workspaceBinaryLimit = 32 * 1024 * 1024

export type WorkspaceTarget = { timelineId: string; branchId: string }
export type WorkspaceMutation =
  | { kind: 'create'; entry: WorkspaceEntry }
  | { kind: 'write'; entryId: string; content: string | Uint8Array; mediaType?: string }
  | { kind: 'copy'; entryId: string; parentId?: string; name: string }
  | { kind: 'move'; entryId: string; parentId?: string; name: string }
  | { kind: 'delete'; entryId: string }
export type WorkspaceMutationInput = WorkspaceTarget & { expectedRevisionId: string; operations: WorkspaceMutation[] }
type Context = Pick<ApplicationRuntimeContext, 'narratives' | 'workspaces' | 'dataEngine' | 'blobs' | 'createId'>

export function createWorkspaceRuntimeMethods(ctx: Context) {
  async function getTimelineWorkspace(target: WorkspaceTarget): Promise<WorkspaceRevision> {
    const branch = await requireNarratives(ctx).getBranch(target.branchId)
    if (!branch || branch.timelineId !== target.timelineId) throw new Error('Workspace Timeline or branch is unavailable')
    const revision = await ctx.workspaces.get(branch.workspaceHeadRevisionId)
    if (!revision || revision.timelineId !== target.timelineId) throw new Error('Workspace revision is unavailable')
    return revision
  }
  return {
    getTimelineWorkspace,
    readWorkspaceFile: async (target: WorkspaceTarget & { entryId: string }) => {
      const revision = await getTimelineWorkspace(target)
      const entry = revision.entries.find(entry => entry.id === target.entryId)
      if (entry?.kind !== 'file') throw new Error('Workspace file is unavailable')
      const bytes = 'text' in entry.content ? new TextEncoder().encode(entry.content.text)
        : await requireBlobs(ctx).read(entry.content.blobId)
      return { revisionId: revision.id, bytes }
    },
    mutateTimelineWorkspace: async (input: WorkspaceMutationInput, request?: RuntimeRequestContext) => {
      const baseline = await getTimelineWorkspace(input)
      if (baseline.id !== input.expectedRevisionId) throw new Error('Workspace changed after it was read')
      const entries = structuredClone(baseline.entries)
      const blobs: PreparedBlobStorageWrite[] = []
      for (const operation of input.operations) {
        if (operation.kind === 'create') {
          // Blob references are only accepted through a byte write, never by an Agent-supplied ID.
          if (operation.entry.kind === 'file' && !('text' in operation.entry.content)) throw new Error('Create files with text, then write binary bytes')
          entries.push(structuredClone(operation.entry))
          continue
        }
        const entry = entries.find(entry => entry.id === operation.entryId)
        if (!entry) throw new Error('Workspace entry is unavailable')
        if (operation.kind === 'copy') {
          const descendants = new Set([entry.id])
          let changed = true
          while (changed) {
            changed = false
            for (const child of entries) if (child.parentId && descendants.has(child.parentId) && !descendants.has(child.id)) {
              descendants.add(child.id); changed = true
            }
          }
          const ids = new Map([...descendants].map(id => [id, ctx.createId('workspace-entry')]))
          const copies = entries.filter(child => descendants.has(child.id)).map(child => ({ ...structuredClone(child), id: ids.get(child.id)!,
            parentId: child.id === entry.id ? operation.parentId : ids.get(child.parentId!), name: child.id === entry.id ? operation.name : child.name,
          }))
          entries.push(...copies)
        } else if (operation.kind === 'write') {
          if (entry.kind !== 'file') throw new Error('Cannot write a Workspace directory')
          if (typeof operation.content === 'string') entry.content = { text: operation.content }
          else {
            const prepared = await requireBlobs(ctx).prepareWrite({ source: operation.content, mediaType: operation.mediaType, maxBytes: workspaceBinaryLimit })
            blobs.push(prepared)
            entry.content = { blobId: prepared.blob.id, mediaType: prepared.blob.mediaType }
          }
        } else if (operation.kind === 'move') {
          entry.parentId = operation.parentId
          entry.name = operation.name
        } else {
          const removed = new Set([entry.id])
          let changed = true
          while (changed) {
            changed = false
            for (const child of entries) if (child.parentId && removed.has(child.parentId) && !removed.has(child.id)) {
              removed.add(child.id); changed = true
            }
          }
          for (let index = entries.length - 1; index >= 0; index--) if (removed.has(entries[index]!.id)) entries.splice(index, 1)
        }
      }
      const result = await ctx.dataEngine.transact(narrativeWriteContext(request, 'application.mutateTimelineWorkspace'), async tx => {
        const committedBlobs = new Map(blobs.map(prepared =>
          [prepared.blob.id, requireBlobs(ctx).participateWrite(tx, prepared).blob] as const))
        for (const entry of entries) {
          if (entry.kind !== 'file' || !('blobId' in entry.content)) continue
          const blob = committedBlobs.get(entry.content.blobId)
          if (blob) entry.content = { blobId: blob.id, mediaType: blob.mediaType }
        }
        const revision = ctx.workspaces.transaction(tx).create({ timelineId: input.timelineId, parentRevisionId: baseline.id, entries })
        requireNarratives(ctx).transaction(tx).setBranchWorkspaceHead({ ...input, revisionId: revision.id })
        return revision
      })
      return { revision: result.value, mutation: { changesetId: result.commit.changesetId } }
    },
  }
}
function requireBlobs(ctx: Pick<Context, 'blobs'>) {
  if (!ctx.blobs) throw new Error('Blob Storage is required for binary Workspace files')
  return ctx.blobs
}
