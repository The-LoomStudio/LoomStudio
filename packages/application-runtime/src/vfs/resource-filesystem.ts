import { createHash, randomUUID } from 'node:crypto'
import type {
  PromptResourceNodePatch,
  PromptResourceNodeDraft,
  PromptResourceStore,
  PromptResourceTreeNode,
} from '@loom-studio/application-data'
import type { JsonObject, JsonValue } from '@loom-studio/shared'
import { applyPatch, parsePatch } from 'diff'
import { parse, stringify } from 'yaml'
import { listVfs, readVfs, searchVfs, vfsError, vfsPath } from './read.js'
import type {
  VfsBinding,
  VfsApprovalControl,
  VfsEntry,
  VfsMutationDecision,
  VfsMutationPreview,
  VfsReadObservation,
  VfsStateTarget,
} from './types.js'

export type ResourceVfsOptions = {
  projections: readonly VfsEntry[]
  resourceMode?: 'play' | 'author'
  narrative?: {
    snapshot(path: string, signal: AbortSignal, control?: VfsApprovalControl): Promise<VfsEntry[]>
    write(input: { nodeId: string; expectedRaw: string; content: string }): Promise<{ nodeId: string }>
  }
  resources?: {
    store: Pick<PromptResourceStore, 'getResource'>
    ids: readonly string[]
    access(resourceId: string, nodeId: string): 'read' | 'locked' | 'hidden'
    write?(input: {
      resourceId: string
      nodeId: string
      expectedVersion: number
      body: string
    }): Promise<{ version: number; changesetId: string }>
    configure?(input: {
      resourceId: string
      nodeId: string
      expectedVersion: number
      patch: PromptResourceNodePatch
    }): Promise<{ version: number; changesetId: string }>
    move?(input: {
      resourceId: string
      nodeId: string
      parentNodeId: string
      orderIndex: number
      expectedVersion: number
    }): Promise<{ version: number; changesetId: string }>
    delete?(input: {
      resourceId: string
      nodeId: string
      expectedVersion: number
    }): Promise<{ version: number; changesetId: string }>
    create?(input: {
      resourceId: string
      parentNodeId: string
      expectedVersion: number
      node: Omit<PromptResourceNodeDraft, 'id'>
    }): Promise<{ nodeId: string; version: number; changesetId: string }>
    copyNode?(input: {
      resourceId: string
      sourceNodeId: string
      parentNodeId: string
      expectedVersion: number
      name?: string
    }): Promise<{ nodeId: string; nodeCount: number; version: number; changesetId: string }>
    duplicateResource?(input: {
      resourceId: string
      expectedVersion: number
      name?: string
    }): Promise<{ resourceId: string; label: string; version: number; changesetId: string }>
  }
  approveMutation?(preview: VfsMutationPreview, signal: AbortSignal): Promise<VfsMutationDecision>
  state?: {
    target: VfsStateTarget
    canAccess(target: VfsStateTarget): boolean
    read(target: VfsStateTarget): Promise<{ revisionId: string; value: JsonObject }>
    write?(input: {
      target: VfsStateTarget
      pointer: string
      expectedRevisionId: string
      value: JsonValue
      idempotencyKey: string
    }): Promise<{ revisionId: string; changesetId?: string }>
  }
  attachments?: () => Promise<VfsTextAttachment[]>
}

export type VfsTextAttachment = {
  identity: string
  name: string
  binding: VfsBinding
  read(signal: AbortSignal): Promise<string>
}

type File = VfsEntry & { identity: string; load?(signal: AbortSignal): Promise<string> }
type ObservedRead = {
  observation: VfsReadObservation
  ranges: Array<[number, number]>
}

export type ResourceVfs = ReturnType<typeof createResourceVfs>

export function createResourceVfs(options: ResourceVfsOptions) {
  // Retained only for this host scope, independently of individual JavaScript sandboxes.
  const pathOwners = new Map<string, string>()
  const observed = new Map<string, ObservedRead>()
  let authorMode = options.resourceMode === 'author'

  function claim(path: string, identity: string) {
    const owner = pathOwners.get(path)
    if (owner !== undefined && owner !== identity) {
      throw vfsError('vfs.path_rebound', `The target previously at ${path} was replaced. Start a fresh resource scope before accessing its replacement.`)
    }
    pathOwners.set(path, identity)
  }

  async function snapshot(path: string, signal: AbortSignal, includeRootContent = false, control?: VfsApprovalControl): Promise<File[]> {
    // ponytail: Bound host-side traversal until domain stores expose subtree paging; never silently return an incomplete view.
    signal.throwIfAborted()
    const files: File[] = options.projections.map(entry => ({ ...entry, identity: `projection:${entry.path}` }))
    if (options.narrative && (path === '/' || path === '/narrative' || path.startsWith('/narrative/'))) {
      const entries = await options.narrative.snapshot(path, signal, control)
      files.push(...entries.map(entry => ({ ...entry, identity: `narrative:${entry.path}` })))
    }
    if (!files.some(entry => entry.path === '/')) files.unshift({ path: '/', kind: 'directory', identity: 'root' })
    if (options.resources) {
      files.push({ path: '/resources', kind: 'directory', identity: 'resources' })
      if (path === '/' || path === '/resources' || path.startsWith('/resources/')) {
        const resources = []
        for (const id of options.resources.ids) {
          signal.throwIfAborted()
          const resource = await options.resources.store.getResource(id)
            if (resource && !resource.tombstoned && (authorMode || resource.rootNode.enabled !== false)
              && options.resources.access(id, resource.rootNodeId) !== 'hidden')
            resources.push(resource)
        }
        const roots = allocateNames(resources.map(resource => ({ id: resource.id, label: resource.label })))
        for (const [index, resource] of resources.entries()) {
          const root = `/resources/${roots[index]}`
          const state = options.resources.access(resource.id, resource.rootNodeId)
          files.push({
            path: root, kind: 'directory', identity: `resource:${resource.id}`,
            binding: {
              kind: 'prompt-resource', resourceId: resource.id, nodeId: resource.rootNodeId,
              version: resource.version, field: 'body',
            },
            ...(state === 'locked' ? { state: 'locked' as const } : {}),
          })
          if (state !== 'read') continue
          if (!includeRootContent && (path === '/' || path === '/resources')) continue
          if (path !== '/' && path !== '/resources' && path !== root && !path.startsWith(`${root}/`)) continue
          const visit = (nodes: PromptResourceTreeNode[], parent: string, disabled: boolean, depth = 0) => {
            if (depth > 128 || files.length > 20_000) throw vfsError('vfs.view_limit', 'Resource view exceeds the traversal budget. Narrow the mounted resources.')
            const visible = nodes.filter(node => options.resources!.access(resource.id, node.id) !== 'hidden'
              && (authorMode || (!disabled && node.enabled !== false)))
            const names = allocateNames(visible.map(node => ({
              id: node.id, label: node.label,
              extension: typeof node.body === 'string' && !node.children?.length ? node.kind === 'script' ? '.js' : '.md' : undefined,
            })))
            for (const [childIndex, node] of visible.entries()) {
              if (files.length > 20_000) throw vfsError('vfs.view_limit', 'Resource view exceeds the traversal budget. Narrow the mounted resources.')
              const current = `${parent}/${names[childIndex]}`
              const access = options.resources!.access(resource.id, node.id)
              const isDirectory = Boolean(node.children?.length) || typeof node.body !== 'string'
              const state = access === 'locked' ? 'locked' : disabled || node.enabled === false ? 'disabled' : undefined
              const binding: VfsBinding = { kind: 'prompt-resource', resourceId: resource.id, nodeId: node.id, version: resource.version, field: 'body' }
              const metadataBinding: VfsBinding = { ...binding, field: 'metadata' }
              const metadataPath = isDirectory ? `${current}/@meta.yaml` : `${current}.meta.yaml`
              files.push({
                path: current, kind: isDirectory ? 'directory' : 'file', identity: `node:${resource.id}:${node.id}`,
                ...(state ? { state } : {}),
                binding,
                ...(!isDirectory ? { content: access === 'read' ? node.body : undefined } : {}),
              })
              if (access !== 'read') continue
              if (authorMode) files.push({
                path: metadataPath,
                kind: 'file',
                identity: `metadata:${resource.id}:${node.id}`,
                content: stringify(nodeMetadata(node)),
                binding: metadataBinding,
              })
              if (isDirectory) {
                if (typeof node.body === 'string') {
                  files.push({ path: `${current}/@body.md`, kind: 'file', identity: `body:${resource.id}:${node.id}`, content: node.body, binding })
                }
                if (includeRootContent || path === current || path.startsWith(`${current}/`))
                  visit(node.children ?? [], current, disabled || node.enabled === false, depth + 1)
              }
            }
          }
          if (typeof resource.rootNode.body === 'string') files.push({
            path: `${root}/@body.md`, kind: 'file', identity: `body:${resource.id}:${resource.rootNode.id}`,
            content: resource.rootNode.body,
            binding: { kind: 'prompt-resource', resourceId: resource.id, nodeId: resource.rootNode.id, version: resource.version, field: 'body' },
          })
          if (authorMode) files.push({
            path: `${root}/@meta.yaml`,
            kind: 'file',
            identity: `metadata:${resource.id}:${resource.rootNode.id}`,
            content: stringify(nodeMetadata(resource.rootNode)),
            binding: {
              kind: 'prompt-resource', resourceId: resource.id, nodeId: resource.rootNode.id,
              version: resource.version, field: 'metadata',
            },
          })
          visit(resource.rootNode.children ?? [], root, resource.rootNode.enabled === false)
        }
      }
    }
    const state = options.state
    if (state?.canAccess(state.target)) {
      files.push({ path: '/state', kind: 'directory', identity: 'state' })
      if (path === '/' && includeRootContent || path === '/state' || path.startsWith('/state/')) {
        const snapshot = await state.read(state.target)
        signal.throwIfAborted()
        if (!state.canAccess(state.target)) throw vfsError('vfs.permission_changed', 'State access changed during reading.')
        const binding = (pointer: string): VfsBinding => ({
          kind: 'state', target: state.target, revisionId: snapshot.revisionId, pointer,
        })
        files.push({ path: '/state/current.yaml', kind: 'file', identity: 'state:', load: async () => stringify(snapshot.value), state: 'current', binding: binding('') })
        const visit = (value: JsonValue, parent: string, pointer: string, depth = 0) => {
          if (depth > 128 || files.length > 20_000) throw vfsError('vfs.view_limit', 'State view exceeds the traversal budget. Narrow the State path.')
          if (value === null || typeof value !== 'object' || Array.isArray(value)) return
          for (const [key, child] of Object.entries(value)) {
            if (files.length > 20_000) throw vfsError('vfs.view_limit', 'State view exceeds the traversal budget. Narrow the State path.')
            const segment = safeSegment(key)
            const childPath = `${parent}/${segment}`
            const childPointer = `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`
            // Every property is a directory with its own YAML value; no collision between scalar and object names.
            files.push({ path: childPath, kind: 'directory', identity: `state-dir:${childPointer}` })
            files.push({
              path: `${childPath}/@value.yaml`, kind: 'file', identity: `state:${childPointer}`,
              load: async () => stringify(child), state: 'current', binding: binding(childPointer),
            })
            if (includeRootContent || path === childPath || path.startsWith(`${childPath}/`)) visit(child, childPath, childPointer, depth + 1)
          }
        }
        files.push({ path: '/state/data', kind: 'directory', identity: 'state-data' })
        visit(snapshot.value, '/state/data', '')
      }
    }
    if (options.attachments) {
      files.push({ path: '/attachments', kind: 'directory', identity: 'attachments' })
      if (path === '/attachments' || path.startsWith('/attachments/') || path === '/' && includeRootContent) {
        const attachments = await options.attachments()
        const names = allocateNames(attachments.map(item => ({ id: item.identity, label: item.name })))
        attachments.forEach((item, index) => files.push({
          path: `/attachments/${names[index]}`, kind: 'file', identity: item.identity,
          binding: item.binding, load: item.read,
        }))
      }
    }
    signal.throwIfAborted()
    const unique = new Set<string>()
    for (const file of files) {
      if (unique.has(file.path)) throw vfsError('vfs.path_collision', `Conflicting virtual path: ${file.path}.`)
      unique.add(file.path)
    }
    return files
  }

  return {
    async setAuthorMode(args: unknown[], signal: AbortSignal, control?: VfsApprovalControl) {
      if (args.length !== 1 || typeof args[0] !== 'boolean')
        throw vfsError('vfs.invalid_arguments', 'Use ctx.setAuthorMode(true | false).')
      signal.throwIfAborted()
      if (args[0] && !authorMode) {
        if (!options.approveMutation) throw vfsError('vfs.author_denied', 'Author mode requires user approval in this host.')
        await approveMutation({
          action: 'author-mode', path: '/resources', kind: 'prompt-resource',
          before: '游玩视图：正文，不包含停用条目与作者元数据。',
          after: '本轮 Run 开放已挂载资源的作者视图：包括停用条目与 Metadata。访问锁仍生效；修改仍需单独批准。',
        }, signal, control)
      }
      signal.throwIfAborted()
      authorMode = args[0]
      observed.clear()
      return { mode: authorMode ? 'author' : 'play' }
    },
    async ls(args: unknown[], signal: AbortSignal, control?: VfsApprovalControl) {
      const path = vfsPath(args[0] ?? '/')
      const files = await snapshot(path, signal, false, control)
      const target = files.find(file => file.path === path)
      if (target?.state === 'locked') throw vfsError('vfs.locked', 'This directory is locked.')
      // Claim all visible children before emitting paths; a later rename must not silently retarget them.
      const prefix = path === '/' ? '/' : `${path}/`
      for (const file of files.filter(file => file.path === path || file.path.startsWith(prefix) && !file.path.slice(prefix.length).includes('/')))
        claim(file.path, file.identity)
      return listVfs(files, args)
    },
    async search(args: unknown[], signal: AbortSignal, control?: VfsApprovalControl) {
      const input = args[0] as { path?: unknown } | undefined
      const path = vfsPath(input?.path ?? '/')
      const files = await snapshot(path, signal, true, control)
      const prefix = path === '/' ? '/' : `${path}/`
      for (const file of files.filter(file => file.path === path || file.path.startsWith(prefix))) claim(file.path, file.identity)
      if (files.find(file => file.path === path)?.state === 'locked') throw vfsError('vfs.locked', 'This resource is locked.')
      let scannedChars = 0
      for (const file of files) {
        if (file.load && (file.path === path || file.path.startsWith(prefix))) {
          signal.throwIfAborted()
          file.content = await file.load(signal)
        }
        if (file.kind === 'file' && file.state !== 'locked' && (file.path === path || file.path.startsWith(prefix))) {
          scannedChars += file.content?.length ?? 0
          if (scannedChars > 2 * 1024 * 1024)
            throw vfsError('vfs.search_budget', 'Search exceeds 2 Mi characters of source text. Narrow the path; no complete search result was returned.')
        }
      }
      return searchVfs(files, args)
    },
    async read(args: unknown[], signal: AbortSignal, control?: VfsApprovalControl) {
      const path = vfsPath(args[0])
      const files = await snapshot(path, signal, false, control)
      const file = files.find(item => item.path === path)
      if (file) claim(path, file.identity)
      if (file?.load) file.content = await file.load(signal)
      signal.throwIfAborted()
      const result = readVfs(files, args)
      const previous = observed.get(path)
      const sameBinding = previous && sameBindingVersion(previous.observation.binding, result.observation.binding)
      observed.set(path, {
        observation: structuredClone(result.observation),
        ranges: sameBinding
          ? mergeRanges(previous.ranges, [result.observation.startLine, result.observation.endLine])
          : [[result.observation.startLine, result.observation.endLine]],
      })
      return result
    },
    async write(
      args: unknown[],
      signal: AbortSignal,
      operationId: string = randomUUID(),
      approvalControl?: VfsApprovalControl,
    ) {
      if (args.length < 2 || args.length > 3)
        throw vfsError('vfs.invalid_arguments', 'Use ctx.write(path, value, { mode?: "replace" }).')
      const path = vfsPath(args[0])
      const rawOptions = args[2] === undefined ? {} : args[2]
      if (typeof rawOptions !== 'object' || rawOptions === null || Array.isArray(rawOptions)
        || Object.keys(rawOptions).some(key => key !== 'mode')
        || ((rawOptions as { mode?: unknown }).mode !== undefined && (rawOptions as { mode?: unknown }).mode !== 'replace')) {
        throw vfsError('vfs.invalid_options', 'The only supported write mode is replace.')
      }
      const observedValue = observed.get(path)
      if (!observedValue?.observation.binding)
        throw vfsError('vfs.read_required', 'Read this exact path first. The read result provides the write baseline.')
      const files = await snapshot(path, signal, false, approvalControl)
      const file = files.find(item => item.path === path)
      if (!file) throw vfsError('vfs.not_found', `Path unavailable: ${path}.`)
      claim(path, file.identity)
      if (file.state === 'locked') throw vfsError('vfs.locked', 'This resource is visible but not writable in the current scope.')
      if (!sameBindingVersion(observedValue.observation.binding, file.binding))
        throw vfsError('vfs.baseline_changed', 'The resource changed after it was read. Read the path again before writing.')
      if (observedValue.ranges.length !== 1 || observedValue.ranges[0]![0] !== 1
        || observedValue.ranges[0]![1] !== observedValue.observation.totalLines)
        throw vfsError('vfs.full_read_required', 'A full resource read is required before replace. Use a narrower read only for inspection.')
      const binding = file.binding
      if (binding?.kind === 'narrative') {
        if (typeof args[1] !== 'string' || !args[1].trim())
          throw vfsError('vfs.value_invalid', 'Narrative content must be nonempty text.')
        await approveMutation({ action: 'replace', path, kind: 'narrative', before: file.content!, after: args[1] }, signal, approvalControl)
        const result = await options.narrative!.write({ nodeId: binding.nodeId, expectedRaw: binding.raw, content: args[1] })
        return { path: `/narrative/${encodeURIComponent(result.nodeId)}.md`, modified: true }
      }
      if (binding?.kind === 'prompt-resource') {
        requireAuthorMode()
        if (typeof args[1] !== 'string') throw vfsError('vfs.value_invalid', 'Prompt Resource bodies must be strings.')
        if (binding.field === 'metadata') {
          const patch = parseNodeMetadata(args[1])
          if (!options.resources?.configure) throw vfsError('vfs.write_unavailable', 'Prompt Resource Metadata writing is unavailable in this scope.')
          await approveMutation({
            action: 'replace', path, kind: binding.kind,
            before: file.content!, after: args[1],
          }, signal, approvalControl)
          const result = await options.resources.configure({
            resourceId: binding.resourceId,
            nodeId: binding.nodeId,
            expectedVersion: binding.version,
            patch,
          })
          return {
            path, kind: binding.kind, field: binding.field, resourceId: binding.resourceId, nodeId: binding.nodeId,
            version: result.version, changesetId: result.changesetId, modified: true,
          }
        }
        if (!options.resources?.write) throw vfsError('vfs.write_unavailable', 'Prompt Resource writing is unavailable in this scope.')
        await approveMutation({
          action: 'replace', path, kind: binding.kind,
          before: file.content!, after: args[1],
        }, signal, approvalControl)
        const result = await options.resources.write({
          resourceId: binding.resourceId,
          nodeId: binding.nodeId,
          expectedVersion: binding.version,
          body: args[1],
        })
        return {
          path, kind: binding.kind, resourceId: binding.resourceId, nodeId: binding.nodeId,
          version: result.version, changesetId: result.changesetId, modified: true,
        }
      }
      if (binding?.kind === 'state') {
        if (!binding.pointer) throw vfsError('vfs.write_unsupported', 'Write a State property under /state/data, not the complete State snapshot.')
        if (!options.state?.write) throw vfsError('vfs.write_unavailable', 'State writing is unavailable in this scope.')
        const before = await file.load!(signal)
        await approveMutation({
          action: 'replace', path, kind: binding.kind,
          before, after: stringify(args[1] as JsonValue),
          target: binding.target, pointer: binding.pointer,
        }, signal, approvalControl)
        const result = await options.state.write({
          target: binding.target,
          pointer: binding.pointer,
          expectedRevisionId: binding.revisionId,
          value: args[1] as JsonValue,
          idempotencyKey: operationId,
        })
        return {
          path, kind: binding.kind, pointer: binding.pointer,
          revisionId: result.revisionId, ...(result.changesetId ? { changesetId: result.changesetId } : {}),
          modified: true,
        }
      }
      throw vfsError('vfs.write_unsupported', 'This VFS file is not a writable domain resource.')
    },
    async patch(args: unknown[], signal: AbortSignal, approvalControl?: VfsApprovalControl) {
      if (args.length !== 2 || typeof args[1] !== 'string')
        throw vfsError('vfs.invalid_arguments', 'Use ctx.patch(path, unifiedDiff).')
      const path = vfsPath(args[0])
      const observedValue = observed.get(path)
      if (!observedValue?.observation.binding)
        throw vfsError('vfs.read_required', 'Read the target range first. The read result provides the patch baseline.')
      const files = await snapshot(path, signal)
      const file = files.find(item => item.path === path)
      if (!file) throw vfsError('vfs.not_found', `Path unavailable: ${path}.`)
      claim(path, file.identity)
      if (file.state === 'locked') throw vfsError('vfs.locked', 'This resource is visible but not writable in the current scope.')
      if (!sameBindingVersion(observedValue.observation.binding, file.binding))
        throw vfsError('vfs.baseline_changed', 'The resource changed after it was read. Read the path again before applying the patch.')
      if (file.binding?.kind !== 'prompt-resource')
        throw vfsError('vfs.write_unsupported', 'Patch is currently available only for Prompt Resource bodies.')
      if (file.binding.field !== 'body')
        throw vfsError('vfs.write_unsupported', 'Patch is only available for Prompt Resource bodies; write Metadata as YAML.')
      if (!options.resources?.write)
        throw vfsError('vfs.write_unavailable', 'Prompt Resource writing is unavailable in this scope.')
      if (typeof file.content !== 'string')
        throw vfsError('vfs.not_file', 'The target does not contain writable text.')
      requireAuthorMode()

      let patches: ReturnType<typeof parsePatch>
      try {
        patches = parsePatch(args[1])
      } catch (error) {
        throw vfsError('vfs.patch_invalid', `Invalid unified diff: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (patches.length !== 1 || !patches[0]!.hunks.length)
        throw vfsError('vfs.patch_invalid', 'Provide one non-empty single-file unified diff.')
      const parsed = patches[0]!
      if (parsed.oldFileName !== path || parsed.newFileName !== path)
        throw vfsError('vfs.patch_target_mismatch', 'The --- and +++ paths must equal the ctx.patch path.')

      const before = file.content
      const lines = before.replace(/\n$/, '').split('\n')
      let previousEnd = 0
      let offset = 0
      for (const hunk of parsed.hunks) {
        if (hunk.lines.some(line => line.startsWith('\\')))
          throw vfsError('vfs.patch_invalid', 'EOF newline markers are not accepted; the original newline style is preserved.')
        const oldLines = hunk.lines
          .filter(line => line.startsWith(' ') || line.startsWith('-'))
          .map(line => line.slice(1))
        if (!oldLines.length)
          throw vfsError('vfs.patch_context_required', 'Every patch block needs existing text as context; insertion-only patches are not supported.')
        const matches: number[] = []
        for (let index = 0; index + oldLines.length <= lines.length; index++) {
          if (oldLines.every((line, lineIndex) => lines[index + lineIndex] === line)) matches.push(index)
        }
        if (!matches.length)
          throw vfsError('vfs.patch_context_mismatch', 'The old text or context does not match. Read the current range and create a new patch.')
        if (matches.length !== 1)
          throw vfsError('vfs.patch_ambiguous', 'The old context matches multiple locations. Add more surrounding context.')
        const start = matches[0]!
        if (start < previousEnd)
          throw vfsError('vfs.patch_overlap', 'Patch blocks must be ordered and must not overlap.')
        for (let line = start + 1; line <= start + oldLines.length; line++) {
          if (!observedValue.ranges.some(([first, last]) => line >= first && line <= last))
            throw vfsError('vfs.patch_range_not_read', 'The patch touches unread text. Read the complete affected range first.')
        }
        hunk.oldStart = start + 1
        hunk.newStart = start + offset + (hunk.newLines ? 1 : 0)
        previousEnd = start + oldLines.length
        offset += hunk.newLines - hunk.oldLines
      }

      const applied = applyPatch(before.endsWith('\n') ? before : `${before}\n`, parsed, { fuzzFactor: 0 })
      if (applied === false)
        throw vfsError('vfs.patch_context_mismatch', 'The patch could not be applied exactly; nothing was written. Read the current text and try again.')
      const after = before.endsWith('\n') ? applied : applied.replace(/\n$/, '')
      if (after === before) return { path, kind: file.binding.kind, modified: false }
      signal.throwIfAborted()
      await approveMutation({
        action: 'patch', path, kind: file.binding.kind, before, after,
      }, signal, approvalControl)
      const result = await options.resources.write({
        resourceId: file.binding.resourceId,
        nodeId: file.binding.nodeId,
        expectedVersion: file.binding.version,
        body: after,
      })
      return {
        path, kind: file.binding.kind, resourceId: file.binding.resourceId, nodeId: file.binding.nodeId,
        version: result.version, changesetId: result.changesetId, modified: true, mode: 'patch',
      }
    },
    async move(args: unknown[], signal: AbortSignal, approvalControl?: VfsApprovalControl) {
      if (args.length !== 3 || typeof args[1] !== 'string' || typeof args[2] !== 'number'
        || !Number.isSafeInteger(args[2]) || args[2] < 0)
        throw vfsError('vfs.invalid_arguments', 'Use ctx.move(path, parentPath, orderIndex).')
      const path = vfsPath(args[0])
      const parentPath = vfsPath(args[1])
      const target = await resolveStructuralTarget(path, signal)
      const parent = await resolveDirectory(parentPath, signal)
      if (!target.binding || target.binding.kind !== 'prompt-resource' || !parent.binding || parent.binding.kind !== 'prompt-resource')
        throw vfsError('vfs.write_unsupported', 'Move is currently available only inside one Prompt Resource.')
      if (target.binding.nodeId === parent.binding.nodeId)
        throw vfsError('vfs.cycle', 'A node cannot move into itself.')
      if (!options.resources?.move) throw vfsError('vfs.write_unavailable', 'Prompt Resource moving is unavailable in this scope.')
      if (target.binding.resourceId !== parent.binding.resourceId)
        throw vfsError('vfs.cross_resource', 'A node cannot move across Prompt Resources.')
      await approveMutation({
        action: 'move', path, kind: 'prompt-resource',
        before: stringify({ path }),
        after: stringify({ path, parentPath, orderIndex: args[2] }),
      }, signal, approvalControl)
      const result = await options.resources.move({
        resourceId: target.binding.resourceId,
        nodeId: target.binding.nodeId,
        parentNodeId: parent.binding.nodeId,
        orderIndex: args[2],
        expectedVersion: target.binding.version,
      })
      return {
        path, parentPath, kind: 'prompt-resource', resourceId: target.binding.resourceId,
        nodeId: target.binding.nodeId, version: result.version, changesetId: result.changesetId, modified: true,
      }
    },
    async delete(args: unknown[], signal: AbortSignal, approvalControl?: VfsApprovalControl) {
      if (args.length !== 1) throw vfsError('vfs.invalid_arguments', 'Use ctx.delete(path).')
      const path = vfsPath(args[0])
      const target = await resolveStructuralTarget(path, signal)
      if (!target.binding || target.binding.kind !== 'prompt-resource')
        throw vfsError('vfs.write_unsupported', 'Delete is currently available only for Prompt Resource nodes.')
      const resource = await options.resources?.store.getResource(target.binding.resourceId)
      if (target.identity.startsWith('resource:') || resource?.rootNodeId === target.binding.nodeId)
        throw vfsError('vfs.root_delete', 'The Prompt Resource root cannot be deleted through VFS.')
      if (!options.resources?.delete) throw vfsError('vfs.write_unavailable', 'Prompt Resource deletion is unavailable in this scope.')
      await approveMutation({
        action: 'delete', path, kind: 'prompt-resource',
        before: target.metadata?.content ?? path, after: '',
      }, signal, approvalControl)
      const result = await options.resources.delete({
        resourceId: target.binding.resourceId,
        nodeId: target.binding.nodeId,
        expectedVersion: target.binding.version,
      })
      return {
        path, kind: 'prompt-resource', resourceId: target.binding.resourceId,
        nodeId: target.binding.nodeId, version: result.version, changesetId: result.changesetId, modified: true,
      }
    },
    async create(args: unknown[], signal: AbortSignal, approvalControl?: VfsApprovalControl) {
      if (args.length !== 2 || typeof args[1] !== 'object' || args[1] === null || Array.isArray(args[1]))
        throw vfsError('vfs.invalid_arguments', 'Use ctx.create(parentPath, { label, kind?, body?, ...metadata }).')
      const parentPath = vfsPath(args[0])
      const parent = await resolveStructuralTarget(parentPath, signal)
      if (!parent.binding || parent.binding.kind !== 'prompt-resource')
        throw vfsError('vfs.write_unsupported', 'Create is currently available only inside a Prompt Resource.')
      if (parent.identity.startsWith('body:'))
        throw vfsError('vfs.not_directory', 'The create parent must be a directory.')
      if (!options.resources?.create) throw vfsError('vfs.write_unavailable', 'Prompt Resource creation is unavailable in this scope.')
      const node = parseNodeDraft(args[1])
      await approveMutation({
        action: 'create', path: parentPath, kind: 'prompt-resource',
        before: '', after: stringify({ parentPath, ...node }),
      }, signal, approvalControl)
      const result = await options.resources.create({
        resourceId: parent.binding.resourceId,
        parentNodeId: parent.binding.nodeId,
        expectedVersion: parent.binding.version,
        node,
      })
      return {
        parentPath, kind: 'prompt-resource', nodeId: result.nodeId,
        version: result.version, changesetId: result.changesetId, modified: true,
      }
    },
    async copy(args: unknown[], signal: AbortSignal, approvalControl?: VfsApprovalControl) {
      if (args.length < 2 || args.length > 3 || typeof args[1] !== 'string')
        throw vfsError('vfs.invalid_arguments', 'Use ctx.copy(sourcePath, destinationPath, { name? }).')
      const sourcePath = vfsPath(args[0])
      const destinationPath = vfsPath(args[1])
      const copyOptions = parseCopyOptions(args[2])
      const source = await resolveStructuralTarget(sourcePath, signal)
      if (!source.binding || source.binding.kind !== 'prompt-resource')
        throw vfsError('vfs.write_unsupported', 'Copy is currently available only for Prompt Resource nodes.')

      if (source.identity.startsWith('resource:')) {
        if (destinationPath !== '/resources')
          throw vfsError('vfs.copy_destination', 'A Prompt Resource root can only be copied into /resources.')
        if (!options.resources?.duplicateResource)
          throw vfsError('vfs.write_unavailable', 'Prompt Resource duplication is unavailable in this scope.')
        await approveMutation({
          action: 'copy', path: sourcePath, kind: 'prompt-resource',
          before: stringify({ sourcePath }),
          after: stringify({ destinationPath, name: copyOptions.name ?? `${sourcePath.split('/').at(-1)} Copy`, resource: 'prompt-resource' }),
        }, signal, approvalControl)
        const result = await options.resources.duplicateResource({
          resourceId: source.binding.resourceId,
          expectedVersion: source.binding.version,
          ...(copyOptions.name === undefined ? {} : { name: copyOptions.name }),
        })
        return {
          sourcePath, destinationPath, kind: 'prompt-resource', resourceId: result.resourceId,
          label: result.label, version: result.version, changesetId: result.changesetId,
          modified: true, resource: true,
        }
      }

      const parent = await resolveDirectory(destinationPath, signal)
      if (!parent.binding || parent.binding.kind !== 'prompt-resource')
        throw vfsError('vfs.copy_destination', 'Copy the node into a Prompt Resource directory.')
      if (source.binding.resourceId !== parent.binding.resourceId)
        throw vfsError('vfs.cross_resource', 'Cross-resource node copy is not available in this scope.')
      if (source.binding.nodeId === parent.binding.nodeId || destinationPath.startsWith(`${sourcePath}/`))
        throw vfsError('vfs.cycle', 'A node cannot be copied into itself or its subtree.')
      if (!options.resources?.copyNode)
        throw vfsError('vfs.write_unavailable', 'Prompt Resource node copying is unavailable in this scope.')
      await approveMutation({
        action: 'copy', path: sourcePath, kind: 'prompt-resource',
        before: stringify({ sourcePath }),
        after: stringify({ destinationPath, ...(copyOptions.name === undefined ? {} : { name: copyOptions.name }), subtree: true }),
      }, signal, approvalControl)
      const result = await options.resources.copyNode({
        resourceId: source.binding.resourceId,
        sourceNodeId: source.binding.nodeId,
        parentNodeId: parent.binding.nodeId,
        expectedVersion: source.binding.version,
        ...(copyOptions.name === undefined ? {} : { name: copyOptions.name }),
      })
      return {
        sourcePath, destinationPath, kind: 'prompt-resource', resourceId: source.binding.resourceId,
        nodeId: result.nodeId, nodeCount: result.nodeCount, version: result.version,
        changesetId: result.changesetId, modified: true,
      }
    },
    observation(path: string) {
      const value = observed.get(path)
      return value ? structuredClone(value.observation) : undefined
    },
  }

  function requireAuthorMode() {
    if (!authorMode) throw vfsError('vfs.author_required', 'Resource editing requires approved author mode. Use ctx.setAuthorMode(true).')
  }

  async function resolveStructuralTarget(path: string, signal: AbortSignal): Promise<{
    identity: string
    binding?: VfsBinding
    metadata?: File
  }> {
    requireAuthorMode()
    const files = await snapshot(path, signal, true)
    const target = files.find(file => file.path === path)
    if (!target) throw vfsError('vfs.not_found', `Path unavailable: ${path}.`)
    claim(path, target.identity)
    if (target.state === 'locked') throw vfsError('vfs.locked', 'This resource is visible but not writable in the current scope.')
    if (target.binding?.kind !== 'prompt-resource')
      throw vfsError('vfs.write_unsupported', 'This path is not a Prompt Resource node.')
    if (target.binding.field !== 'body')
      throw vfsError('vfs.write_unsupported', 'Use the node path, not its Metadata file, for structural operations.')
    const targetBinding = target.binding
    const metadata = files.find(file => file.binding?.kind === 'prompt-resource'
      && file.binding.field === 'metadata'
      && file.binding.resourceId === targetBinding.resourceId
      && file.binding.nodeId === targetBinding.nodeId)
    if (!metadata) throw vfsError('vfs.not_found', `Metadata is unavailable for ${path}.`)
    const baseline = observed.get(metadata.path)
    if (!baseline?.observation.binding)
      throw vfsError('vfs.read_required', `Read ${metadata.path} before changing the node structure.`)
    if (baseline.observation.startLine !== 1 || baseline.observation.endLine !== baseline.observation.totalLines)
      throw vfsError('vfs.full_read_required', 'Read the complete Metadata file before changing the node structure.')
    if (!sameBindingVersion(baseline.observation.binding, metadata.binding))
      throw vfsError('vfs.baseline_changed', 'The node changed after its Metadata was read. Read it again before changing structure.')
    return { identity: target.identity, binding: targetBinding, metadata }
  }

  async function resolveDirectory(path: string, signal: AbortSignal): Promise<{ binding?: VfsBinding }> {
    const files = await snapshot(path, signal, true)
    const target = files.find(file => file.path === path)
    if (!target) throw vfsError('vfs.not_found', `Parent path unavailable: ${path}.`)
    if (target.kind !== 'directory') throw vfsError('vfs.not_directory', 'The move parent must be a directory.')
    if (target.state === 'locked') throw vfsError('vfs.locked', 'The target directory is locked.')
    claim(path, target.identity)
    if (target.binding?.kind !== 'prompt-resource')
      throw vfsError('vfs.write_unsupported', 'The target directory is not a Prompt Resource node.')
    const targetBinding = target.binding
    const metadata = files.find(file => file.binding?.kind === 'prompt-resource'
      && file.binding.field === 'metadata'
      && file.binding.resourceId === targetBinding.resourceId
      && file.binding.nodeId === targetBinding.nodeId)
    if (!metadata) throw vfsError('vfs.not_found', `Metadata is unavailable for ${path}.`)
    const baseline = observed.get(metadata.path)
    if (!baseline?.observation.binding)
      throw vfsError('vfs.read_required', `Read ${metadata.path} before changing the node structure.`)
    if (baseline.observation.startLine !== 1 || baseline.observation.endLine !== baseline.observation.totalLines)
      throw vfsError('vfs.full_read_required', 'Read the complete Metadata file before changing the node structure.')
    if (!sameBindingVersion(baseline.observation.binding, metadata.binding))
      throw vfsError('vfs.baseline_changed', 'The target directory changed after its Metadata was read. Read it again before changing structure.')
    return { binding: targetBinding }
  }

  async function approveMutation(
    preview: VfsMutationPreview,
    signal: AbortSignal,
    approvalControl?: VfsApprovalControl,
  ): Promise<void> {
    signal.throwIfAborted()
    if (!options.approveMutation) return
    const decision = await (approvalControl
      ? approvalControl.waitForUser(() => options.approveMutation!(preview, signal))
      : options.approveMutation(preview, signal))
    signal.throwIfAborted()
    if (decision?.decision !== 'allow' && decision?.decision !== 'deny')
      throw vfsError('vfs.approval_invalid', 'Approval must explicitly allow or deny the proposed change. Nothing was written.')
    if (decision.decision === 'deny')
      throw vfsError('vfs.denied', decision.reason ?? 'The proposed resource change was denied.')
  }
}

function mergeRanges(ranges: Array<[number, number]>, next: [number, number]): Array<[number, number]> {
  const sorted = [...ranges, next].sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const [start, end] of sorted) {
    const previous = merged.at(-1)
    if (previous && start <= previous[1] + 1) previous[1] = Math.max(previous[1], end)
    else merged.push([start, end])
  }
  return merged
}

function nodeMetadata(node: PromptResourceTreeNode): JsonObject {
  return {
    label: node.label,
    ...(node.category === undefined ? {} : { category: node.category }),
    ...(node.meta === undefined ? {} : { meta: node.meta }),
    ...(node.enabled === undefined ? {} : { enabled: node.enabled }),
    ...(node.capabilities === undefined ? {} : { capabilities: node.capabilities }),
    ...(node.extra === undefined ? {} : { extra: node.extra }),
  }
}

function parseNodeMetadata(source: string): PromptResourceNodePatch {
  let value: unknown
  try {
    value = parse(source)
  } catch (error) {
    throw vfsError('vfs.metadata_invalid', `Metadata YAML is invalid: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isObjectRecord(value))
    throw vfsError('vfs.metadata_invalid', 'Metadata must be a YAML object.')
  const allowed = new Set(['label', 'category', 'meta', 'enabled', 'capabilities', 'extra'])
  const unknown = Object.keys(value).find(key => !allowed.has(key))
  if (unknown) throw vfsError('vfs.metadata_invalid', `Metadata field is not writable through VFS: ${unknown}`)
  if (value.label !== undefined && typeof value.label !== 'string')
    throw vfsError('vfs.metadata_invalid', 'Metadata label must be a string.')
  if (value.category !== undefined && value.category !== null && typeof value.category !== 'string')
    throw vfsError('vfs.metadata_invalid', 'Metadata category must be a string or null.')
  if (value.meta !== undefined && value.meta !== null && typeof value.meta !== 'string')
    throw vfsError('vfs.metadata_invalid', 'Metadata meta must be a string or null.')
  if (value.enabled !== undefined && value.enabled !== null && typeof value.enabled !== 'boolean')
    throw vfsError('vfs.metadata_invalid', 'Metadata enabled must be a boolean or null.')
  if (value.extra !== undefined && value.extra !== null && !isObjectRecord(value.extra))
    throw vfsError('vfs.metadata_invalid', 'Metadata extra must be an object or null.')
  return value as PromptResourceNodePatch
}

function parseNodeDraft(value: object): Omit<PromptResourceNodeDraft, 'id'> {
  if (!isObjectRecord(value)) throw vfsError('vfs.create_invalid', 'Create spec must be an object.')
  const allowed = new Set(['label', 'kind', 'category', 'meta', 'enabled', 'body', 'capabilities', 'extra'])
  const unknown = Object.keys(value).find(key => !allowed.has(key))
  if (unknown) throw vfsError('vfs.create_invalid', `Create field is not supported: ${unknown}`)
  if (typeof value.label !== 'string' || !value.label.trim())
    throw vfsError('vfs.create_invalid', 'Create requires a non-empty label.')
  if (value.kind !== undefined && typeof value.kind !== 'string')
    throw vfsError('vfs.create_invalid', 'Create kind must be a string.')
  if (value.body !== undefined && value.body !== null && typeof value.body !== 'string')
    throw vfsError('vfs.create_invalid', 'Create body must be a string or null.')
  if (value.category !== undefined && value.category !== null && typeof value.category !== 'string')
    throw vfsError('vfs.create_invalid', 'Create category must be a string or null.')
  if (value.meta !== undefined && value.meta !== null && typeof value.meta !== 'string')
    throw vfsError('vfs.create_invalid', 'Create meta must be a string or null.')
  if (value.enabled !== undefined && value.enabled !== null && typeof value.enabled !== 'boolean')
    throw vfsError('vfs.create_invalid', 'Create enabled must be a boolean or null.')
  if (value.extra !== undefined && value.extra !== null && !isObjectRecord(value.extra))
    throw vfsError('vfs.create_invalid', 'Create extra must be an object or null.')
  return {
    label: value.label,
    kind: (value.kind ?? 'entry') as PromptResourceNodeDraft['kind'],
    ...(value.category === undefined || value.category === null ? {} : { category: value.category as PromptResourceNodeDraft['category'] }),
    ...(value.meta === undefined || value.meta === null ? {} : { meta: value.meta as string }),
    ...(value.enabled === undefined || value.enabled === null ? {} : { enabled: value.enabled as boolean }),
    ...(value.body === undefined || value.body === null ? {} : { body: value.body as string }),
    ...(value.capabilities === undefined ? {} : { capabilities: value.capabilities }),
    ...(value.extra === undefined || value.extra === null ? {} : { extra: value.extra as JsonObject }),
  }
}

function parseCopyOptions(value: unknown): { name?: string } {
  if (value === undefined) return {}
  if (!isObjectRecord(value) || Object.keys(value).some(key => key !== 'name'))
    throw vfsError('vfs.invalid_options', 'Copy options may contain only: name.')
  if (value.name !== undefined && (typeof value.name !== 'string' || !value.name.trim()))
    throw vfsError('vfs.copy_invalid', 'Copy name must be a non-empty string.')
  return value.name === undefined ? {} : { name: value.name.trim() }
}

function isObjectRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function allocateNames(items: { id: string; label: string; extension?: string }[]): string[] {
  const names = items.map(item => {
    const name = safeSegment(item.label.normalize('NFC'))
    return item.extension && !name.toLowerCase().endsWith(item.extension) ? `${name}${item.extension}` : name
  })
  const counts = new Map<string, number>()
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
  return names.map((name, index) => counts.get(name)! > 1
    ? `${name}~${createHash('sha256').update(items[index]!.id).digest('hex').slice(0, 10)}` : name)
}

function safeSegment(value: string): string {
  if (!value) return '%00'
  if (value === '.' || value === '..') return value.replaceAll('.', '%2E')
  return Array.from(value, char => {
    const code = char.charCodeAt(0)
    return '%/\\@'.includes(char) || code < 32 || code === 127
      ? `%${code.toString(16).toUpperCase().padStart(2, '0')}`
      : char
  }).join('')
}

function sameBindingVersion(
  observed: VfsBinding | undefined,
  current: VfsBinding | undefined,
): boolean {
  if (!observed || !current || observed.kind !== current.kind) return false
  if (observed.kind === 'narrative' && current.kind === 'narrative')
    return observed.nodeId === current.nodeId && observed.timelineId === current.timelineId
      && observed.branchId === current.branchId && observed.raw === current.raw
  if (observed.kind === 'prompt-resource' && current.kind === 'prompt-resource')
    return observed.resourceId === current.resourceId
      && observed.nodeId === current.nodeId
      && observed.version === current.version
  if (observed.kind === 'state' && current.kind === 'state')
    return observed.revisionId === current.revisionId
      && observed.pointer === current.pointer
      && JSON.stringify(observed.target) === JSON.stringify(current.target)
  if (observed.kind === 'script' && current.kind === 'script')
    return observed.documentId === current.documentId && observed.version === current.version
  return false
}
