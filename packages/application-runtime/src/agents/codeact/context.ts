import type { VfsReadObservation } from '../../vfs/types.js'
import { createResourceVfs } from '../../vfs/resource-filesystem.js'
import type { ToolExecutionScope } from '../tool-registry.js'
import type { CodeActHostMethod } from './sandbox.js'
import type { NarrativeSampleSelection } from '../../narrative/sampling.js'

export const codeActMethodNames = ['ls', 'search', 'read', 'readNarrative', 'write', 'patch', 'move', 'delete', 'create', 'copy'] as const

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
  const methods: Partial<Record<typeof codeActMethodNames[number], CodeActHostMethod>> = {
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
  methods.readNarrative = async (args, signal) => {
    signal.throwIfAborted()
    if (!scope?.narrative)
      throw codeActError('codeact.narrative_unavailable', 'No Narrative Timeline is bound to this Agent scope.')
    if (args.length !== 1 || !args[0] || typeof args[0] !== 'object' || Array.isArray(args[0])) {
      throw codeActError('codeact.invalid_arguments', 'Use ctx.readNarrative({ selection, maxNodes?, maxCharacters? }).')
    }
    const request = args[0] as Record<string, unknown>
    const selection = request.selection
    if (!selection || typeof selection !== 'object' || Array.isArray(selection)) {
      throw codeActError('codeact.invalid_arguments', 'Narrative selection must be an object.')
    }
    const result = await scope.narrative.sample({
      selection: selection as NarrativeSampleSelection,
      ...(request.maxNodes === undefined ? {} : { maxNodes: request.maxNodes as number }),
      ...(request.maxCharacters === undefined ? {} : { maxCharacters: request.maxCharacters as number }),
    })
    return result
  }
  return { methods, observations, writes }
}

function codeActError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  return error
}
