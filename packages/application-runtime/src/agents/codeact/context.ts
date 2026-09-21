import type { VfsReadObservation } from '../../vfs/types.js'
import { createResourceVfs } from '../../vfs/resource-filesystem.js'
import type { ToolExecutionScope } from '../tool-registry.js'
import type { CodeActHostMethod } from './sandbox.js'

export const codeActMethodNames = ['ls', 'search', 'read', 'write', 'patch', 'move', 'delete', 'create', 'copy'] as const

export function createCodeActContext(scope: ToolExecutionScope | undefined, operationPrefix = 'codeact') {
  const observations: VfsReadObservation[] = []
  const writes: Array<{ path: string; modified: boolean; changesetId?: string }> = []
  let operationSequence = 0
  const state = scope?.state
  const filesystem = scope?.resourceVfs ?? createResourceVfs({
    projections: scope?.vfs ?? [],
    ...(scope?.approveMutation ? { approveMutation: scope.approveMutation } : {}),
    ...(scope?.vfsAttachments ? { attachments: scope.vfsAttachments } : {}),
    ...(scope?.promptResources && scope.vfsResourceIds ? {
      resources: {
        store: scope.promptResources,
        ids: scope.vfsResourceIds,
        access: () => 'read' as const,
        ...(scope.writePromptResource ? { write: scope.writePromptResource } : {}),
        ...(scope.configurePromptResource ? { configure: scope.configurePromptResource } : {}),
        ...(scope.movePromptResource ? { move: scope.movePromptResource } : {}),
        ...(scope.deletePromptResourceNode ? { delete: scope.deletePromptResourceNode } : {}),
        ...(scope.createPromptResourceNode ? { create: scope.createPromptResourceNode } : {}),
        ...(scope.copyPromptResourceNode ? { copyNode: scope.copyPromptResourceNode } : {}),
        ...(scope.duplicatePromptResource ? { duplicateResource: scope.duplicatePromptResource } : {}),
      },
    } : {}),
    ...(state?.defaultTarget ? {
      state: {
        target: state.defaultTarget,
        canAccess: target => state.canAccess(target),
        read: target => state.read(target),
        ...(state.write ? { write: state.write } : {}),
      },
    } : {}),
  })
  if (scope) scope.resourceVfs = filesystem
  const methods: Record<typeof codeActMethodNames[number], CodeActHostMethod> = {
    ls: (args, signal) => filesystem.ls(args, signal),
    search: (args, signal) => filesystem.search(args, signal),
    read: async (args, signal) => {
      const result = await filesystem.read(args, signal)
      observations.push(result.observation)
      return result.text
    },
    write: async (args, signal, control) => {
      const result = await filesystem.write(args, signal, `${operationPrefix}:${++operationSequence}`, control)
      writes.push(result)
      return JSON.stringify(result)
    },
    patch: async (args, signal, control) => {
      const result = await filesystem.patch(args, signal, control)
      writes.push(result)
      return JSON.stringify(result)
    },
    move: async (args, signal, control) => {
      const result = await filesystem.move(args, signal, control)
      writes.push(result)
      return JSON.stringify(result)
    },
    delete: async (args, signal, control) => {
      const result = await filesystem.delete(args, signal, control)
      writes.push(result)
      return JSON.stringify(result)
    },
    create: async (args, signal, control) => {
      const result = await filesystem.create(args, signal, control)
      writes.push({ ...result, path: result.parentPath })
      return JSON.stringify(result)
    },
    copy: async (args, signal, control) => {
      const result = await filesystem.copy(args, signal, control)
      writes.push({ ...result, path: result.sourcePath })
      return JSON.stringify(result)
    },
  }
  return { methods, observations, writes }
}
