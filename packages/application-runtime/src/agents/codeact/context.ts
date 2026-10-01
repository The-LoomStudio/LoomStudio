import type { VfsReadObservation, VfsApprovalControl } from '../../vfs/types.js'
import { createResourceVfs } from '../../vfs/resource-filesystem.js'
import type { ToolExecutionScope } from '../tool-registry.js'
import type { CodeActHostMethod } from './sandbox.js'
import type { NarrativeSampleSelection } from '../../narrative/sampling.js'

export const codeActMethodNames = ['setAuthorMode', 'ls', 'search', 'read', 'readNarrative', 'appendNarrative', 'write', 'patch', 'move', 'delete', 'create', 'copy'] as const

export function createCodeActContext(scope: ToolExecutionScope | undefined, operationPrefix = 'codeact') {
  const observations: VfsReadObservation[] = []
  const writes: Array<{ path: string; modified: boolean; changesetId?: string }> = []
  const narrativeAppends: Array<{ nodeId: string; timelineId: string; branchId: string }> = []
  let operationSequence = 0
  const state = scope?.state
  const filesystem = scope?.resourceVfs ?? createResourceVfs({
    projections: scope?.vfs ?? [],
    ...(scope?.narrative ? {
      narrative: {
        snapshot: async (path: string, signal: AbortSignal, control?: VfsApprovalControl) => {
          const root = { path: '/narrative', kind: 'directory' as const }
          if (path === '/') return [root]
          const match = /^\/narrative\/([^/]+)\.md$/.exec(path)
          if (path !== '/narrative' && !match) return [root]
          const nodeId = match ? decodeURIComponent(match[1]!) : undefined
          const sample = await scope.narrative!.sample({
            selection: { kind: 'tail', count: nodeId ? 1 : 1000, ...(nodeId ? { throughNodeId: nodeId } : {}) },
            view: 'raw',
          }, signal, undefined, control)
          if (!sample.complete) throw codeActError('vfs.narrative_range_too_large', 'Use ctx.readNarrative with a smaller range to discover node paths.')
          return [root, ...sample.nodes.filter(node => !nodeId || node.id === nodeId).map(node => ({
            path: narrativePath(node.id), kind: 'file' as const, content: node.body.raw,
            binding: {
              kind: 'narrative' as const, nodeId: node.id, timelineId: scope.narrative!.timelineId,
              branchId: scope.narrative!.branchId, raw: node.body.raw,
            },
          }))]
        },
        write: (input: { nodeId: string; expectedRaw: string; content: string }) => scope.narrative!.editNode(input),
      },
    } : {}),
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
    setAuthorMode: (args, signal, control) => filesystem.setAuthorMode(args, signal, control),
    ls: (args, signal, control) => filesystem.ls(args, signal, control),
    search: (args, signal, control) => filesystem.search(args, signal, control),
    read: async (args, signal, control) => {
      const result = await filesystem.read(args, signal, control)
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
  methods.readNarrative = async (args, signal, control) => {
    signal.throwIfAborted()
    if (!scope?.narrative)
      throw codeActError('codeact.narrative_unavailable', 'No Narrative Timeline is bound to this Agent scope.')
    if (args.length !== 1 || !args[0] || typeof args[0] !== 'object' || Array.isArray(args[0])) {
      throw codeActError('codeact.invalid_arguments', 'Use ctx.readNarrative({ selection, maxNodes?, maxCharacters?, view? }).')
    }
    const request = args[0] as Record<string, unknown>
    if (Object.keys(request).some(key => !['selection', 'maxNodes', 'maxCharacters', 'view'].includes(key))) {
      throw codeActError('codeact.invalid_arguments', 'Narrative target and processing rules are supplied by the host.')
    }
    if (request.view !== undefined && request.view !== 'raw' && request.view !== 'prompt') {
      throw codeActError('codeact.invalid_arguments', 'Narrative view must be raw or prompt.')
    }
    const selection = request.selection
    if (!selection || typeof selection !== 'object' || Array.isArray(selection)) {
      throw codeActError('codeact.invalid_arguments', 'Narrative selection must be an object.')
    }
    const selector = selection as Record<string, unknown>
    const keys = selector.kind === 'tail' ? ['kind', 'count', 'throughNodeId'] : ['kind', 'afterNodeId', 'throughNodeId']
    if (Object.keys(selector).some(key => !keys.includes(key))) {
      throw codeActError('codeact.invalid_arguments', 'Unsupported Narrative selection field.')
    }
    const result = await scope.narrative.sample({
      selection: selection as NarrativeSampleSelection,
      ...(request.maxNodes === undefined ? {} : { maxNodes: request.maxNodes as number }),
      ...(request.maxCharacters === undefined ? {} : { maxCharacters: request.maxCharacters as number }),
      ...(request.view === undefined ? {} : { view: request.view }),
    }, signal, undefined, control)
    return { ...result, nodes: result.nodes.map(node => ({ ...node, path: narrativePath(node.id) })) }
  }
  methods.appendNarrative = async (args, signal) => {
    signal.throwIfAborted()
    if (!scope?.narrative)
      throw codeActError('codeact.narrative_unavailable', 'No Narrative Timeline is bound to this Agent scope.')
    if (args.length !== 1 || !args[0] || typeof args[0] !== 'object' || Array.isArray(args[0]))
      throw codeActError('codeact.invalid_arguments', 'Use ctx.appendNarrative({ content }).')
    const request = args[0] as Record<string, unknown>
    if (Object.keys(request).length !== 1 || typeof request.content !== 'string' || !request.content.trim())
      throw codeActError('codeact.invalid_arguments', 'Narrative append requires only nonempty content; the host selects the target.')
    const result = await scope.narrative.appendNode({ content: request.content.trim() })
    const receipt = {
      nodeId: result.nodeId,
      timelineId: scope.narrative.timelineId,
      branchId: scope.narrative.branchId,
    }
    narrativeAppends.push(receipt)
    return { path: narrativePath(result.nodeId) }
  }
  return { methods, observations, writes, narrativeAppends }
}

export function narrativePath(nodeId: string): string {
  return `/narrative/${encodeURIComponent(nodeId)}.md`
}

function codeActError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  return error
}
