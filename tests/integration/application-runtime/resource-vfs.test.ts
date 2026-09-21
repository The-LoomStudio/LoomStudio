import { describe, expect, it } from 'vitest'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createPromptResourceStore } from '@loom-studio/application-data'
import { createResourceVfs, type ResourceVfsOptions } from '../../../packages/application-runtime/src/vfs/resource-filesystem.js'
import { createCodeActContext } from '../../../packages/application-runtime/src/agents/codeact/context.js'
import type { ToolExecutionScope } from '../../../packages/application-runtime/src/agents/tool-registry.js'
import type { JsonObject, JsonValue } from '@loom-studio/shared'

const signal = new AbortController().signal

async function fixture(body = '作者源码 {{name}}\n第二行', approveMutation?: ResourceVfsOptions['approveMutation']) {
  let sequence = 0
  const createId = (prefix: string) => `${prefix}-${++sequence}`
  const now = () => '2026-09-21T00:00:00.000Z'
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const store = createPromptResourceStore({ engine, createId, now })
  const { resource } = await store.createResource({
    actor: { kind: 'kernel', id: 'test' }, resourceKind: 'setting',
    rootNode: {
      id: 'root', label: '爱丽丝', kind: 'module', children: [
        { id: 'personality', kind: 'entry', label: '人设', body },
        { id: 'disabled', kind: 'entry', label: '未启用', body: 'disabled-content', enabled: false },
        { id: 'hidden', kind: 'entry', label: '不可见', body: 'hidden-secret' },
        { id: 'locked', kind: 'entry', label: '未来', body: 'locked-secret' },
      ],
    },
  })
  const access = (_resourceId: string, nodeId: string): 'read' | 'hidden' | 'locked' =>
    nodeId === 'hidden' ? 'hidden' : nodeId === 'locked' ? 'locked' : 'read'
  const fs = createResourceVfs({
    projections: [],
    ...(approveMutation ? { approveMutation } : {}),
    resources: {
      store, ids: [resource.id], access,
      write: async input => {
        const result = await store.mutateResource({
          actor: { kind: 'kernel', id: 'codeact' },
          resourceId: input.resourceId,
          expectedVersion: input.expectedVersion,
          mutations: [{ kind: 'node.update', nodeId: input.nodeId, patch: { body: input.body } }],
        })
        return { version: result.resource.version, changesetId: result.commit.changesetId }
      },
      configure: async input => {
        const result = await store.mutateResource({
          actor: { kind: 'kernel', id: 'codeact' },
          resourceId: input.resourceId,
          expectedVersion: input.expectedVersion,
          mutations: [{ kind: 'node.update', nodeId: input.nodeId, patch: input.patch }],
        })
        return { version: result.resource.version, changesetId: result.commit.changesetId }
      },
      move: async input => {
        const result = await store.mutateResource({
          actor: { kind: 'kernel', id: 'codeact' },
          resourceId: input.resourceId,
          expectedVersion: input.expectedVersion,
          mutations: [{
            kind: 'node.move', nodeId: input.nodeId, parentId: input.parentNodeId, orderIndex: input.orderIndex,
          }],
        })
        return { version: result.resource.version, changesetId: result.commit.changesetId }
      },
      delete: async input => {
        const result = await store.mutateResource({
          actor: { kind: 'kernel', id: 'codeact' },
          resourceId: input.resourceId,
          expectedVersion: input.expectedVersion,
          mutations: [{ kind: 'node.delete', nodeId: input.nodeId }],
        })
        return { version: result.resource.version, changesetId: result.commit.changesetId }
      },
      create: async input => {
        const nodeId = `created-${Date.now()}`
        const result = await store.mutateResource({
          actor: { kind: 'kernel', id: 'codeact' },
          resourceId: input.resourceId,
          expectedVersion: input.expectedVersion,
          mutations: [{ kind: 'node.create', parentId: input.parentNodeId, node: { ...input.node, id: nodeId } }],
        })
        return { nodeId, version: result.resource.version, changesetId: result.commit.changesetId }
      },
      copyNode: async input => {
        const current = await store.getResource(input.resourceId)
        if (!current) throw new Error('resource missing')
        const source = findTreeNode(current.rootNode, input.sourceNodeId)
        if (!source) throw new Error('node missing')
        const mutations: Array<{
          kind: 'node.create'
          parentId: string
          node: {
            id: string
            label: string
            kind: typeof source.kind
            orderIndex?: number
            category?: typeof source.category
            meta?: string
            enabled?: boolean
            body?: string
            capabilities?: JsonValue
            extra?: JsonObject
          }
        }> = []
        let nodeCount = 0
        const append = (node: typeof source, parentId: string, orderIndex?: number, root = false): string => {
          const id = createId('copy-node')
          nodeCount += 1
          mutations.push({
            kind: 'node.create',
            parentId,
            node: {
              id,
              label: root && input.name ? input.name : node.label,
              kind: node.kind,
              ...(orderIndex === undefined ? {} : { orderIndex }),
              ...(node.category === undefined ? {} : { category: node.category }),
              ...(node.meta === undefined ? {} : { meta: node.meta }),
              ...(node.enabled === undefined ? {} : { enabled: node.enabled }),
              ...(node.body === undefined ? {} : { body: node.body }),
              ...(node.capabilities === undefined ? {} : { capabilities: node.capabilities }),
              ...(node.extra === undefined ? {} : { extra: node.extra }),
            },
          })
          node.children?.forEach((child, index) => append(child, id, index))
          return id
        }
        const nodeId = append(source, input.parentNodeId, undefined, true)
        const result = await store.mutateResource({
          actor: { kind: 'kernel', id: 'codeact' },
          resourceId: input.resourceId,
          expectedVersion: input.expectedVersion,
          mutations,
        })
        return { nodeId, nodeCount, version: result.resource.version, changesetId: result.commit.changesetId }
      },
      duplicateResource: async input => {
        const current = await store.getResource(input.resourceId)
        if (!current) throw new Error('resource missing')
        return {
          resourceId: `${current.id}-copy`,
          label: input.name ?? `${current.label} Copy`,
          version: 1,
          changesetId: 'changeset-resource-copy',
        }
      },
    },
  })
  return { engine, store, resource, fs, access }
}

function findTreeNode<T extends { id: string; children?: T[] }>(root: T, id: string): T | undefined {
  if (root.id === id) return root
  for (const child of root.children ?? []) {
    const found = findTreeNode(child, id)
    if (found) return found
  }
  return undefined
}

describe('domain-backed resource VFS', () => {
  it('reads raw source with stable identity and the actual database version, then refreshes after edits', async () => {
    const f = await fixture()
    try {
      expect(await f.fs.ls(['/resources'], signal)).toContain('爱丽丝/')
      const path = '/resources/爱丽丝/人设.md'
      const first = await f.fs.read([path, { startLine: 1, endLine: 1 }], signal)
      expect(first.text).toBe('作者源码 {{name}}')
      expect(first.observation.binding).toEqual({
        kind: 'prompt-resource', resourceId: f.resource.id, nodeId: 'personality', version: f.resource.version, field: 'body',
      })
      const update = await f.store.mutateResource({
        actor: { kind: 'kernel', id: 'user' },
        resourceId: f.resource.id, expectedVersion: f.resource.version,
        mutations: [{ kind: 'node.update', nodeId: 'personality', patch: { body: '已由用户修改' } }],
      })
      expect(f.fs.observation(path)?.binding).toMatchObject({ version: f.resource.version })
      const second = await f.fs.read([path], signal)
      expect(second.text).toBe('已由用户修改')
      expect(second.observation.binding).toMatchObject({ version: update.resource.version })
    } finally { f.engine.close() }
  })

  it('keeps disabled source readable but hides restricted entries and rejects locked content', async () => {
    const f = await fixture()
    try {
      const tree = await f.fs.ls(['/resources/爱丽丝'], signal)
      expect(tree).toContain('未启用.md [disabled]')
      expect(tree).toContain('未来.md [locked]')
      expect(tree).not.toContain('不可见')
      expect((await f.fs.read(['/resources/爱丽丝/未启用.md'], signal)).text).toBe('disabled-content')
      await expect(f.fs.read(['/resources/爱丽丝/未来.md'], signal)).rejects.toMatchObject({ code: 'vfs.locked' })
      await expect(f.fs.read(['/resources/爱丽丝/不可见.md'], signal)).rejects.toMatchObject({ code: 'vfs.not_found' })
      expect(await f.fs.search([{ terms: ['secret'] }], signal)).toContain('No matches')
    } finally { f.engine.close() }
  })

  it('refuses path rebinding after a user renames and replaces an observed node', async () => {
    const f = await fixture()
    try {
      await f.fs.ls(['/resources/爱丽丝'], signal)
      await f.store.mutateResource({
        actor: { kind: 'kernel', id: 'user' }, resourceId: f.resource.id, expectedVersion: f.resource.version,
        mutations: [
          { kind: 'node.update', nodeId: 'personality', patch: { label: '旧人设' } },
          { kind: 'node.create', parentId: 'root', node: { id: 'replacement', kind: 'entry', label: '人设', body: 'wrong-target' } },
        ],
      })
      await expect(f.fs.read(['/resources/爱丽丝/人设.md'], signal)).rejects.toMatchObject({ code: 'vfs.path_rebound' })
      expect((await f.fs.read(['/resources/爱丽丝/旧人设.md'], signal)).observation.binding).toMatchObject({ nodeId: 'personality' })
    } finally { f.engine.close() }
  })

  it('keeps same-label mounts separate and does not expose unmounted resources', async () => {
    const f = await fixture()
    try {
      const { resource: second } = await f.store.createResource({
        actor: { kind: 'kernel', id: 'test' }, resourceKind: 'setting',
        rootNode: { id: 'other-root', kind: 'module', label: '爱丽丝', children: [{ id: 'other-child', kind: 'entry', label: '人设', body: 'second-card' }] },
      })
      expect(await f.fs.search([{ terms: ['second-card'] }], signal)).toContain('No matches')
      const fs = createResourceVfs({ projections: [], resources: { store: f.store, ids: [f.resource.id, second.id], access: f.access } })
      const roots = (await fs.ls(['/resources'], signal)).split('\n').slice(1).map(line => `/resources/${line.trim().replace(/\/$/, '')}`)
      expect(roots).toHaveLength(2)
      expect(new Set(roots).size).toBe(2)
      expect((await fs.read([`${roots[1]}/人设.md`], signal)).text).toBe('second-card')
    } finally { f.engine.close() }
  })

  it('writes a Prompt Resource only after a full read and returns its changeset', async () => {
    const f = await fixture()
    try {
      const path = '/resources/爱丽丝/人设.md'
      await f.fs.read([path], signal)
      const result = await f.fs.write([path, '改写后的人设'], signal)
      expect(result).toMatchObject({ kind: 'prompt-resource', version: 2, modified: true })
      expect(result).toHaveProperty('changesetId')
      expect((await f.store.getResource(f.resource.id))!.rootNode.children!.find(node => node.id === 'personality')!.body)
        .toBe('改写后的人设')
    } finally { f.engine.close() }
  })

  it('projects node Metadata as a virtual YAML file and writes it through the domain mutation', async () => {
    const f = await fixture()
    const path = '/resources/爱丽丝/人设.md.meta.yaml'
    try {
      expect(await f.fs.ls(['/resources/爱丽丝'], signal)).toContain('人设.md.meta.yaml')
      const current = await f.fs.read([path], signal)
      expect(current.text).toContain('label: 人设')
      const result = await f.fs.write([path, 'label: 新人设\nenabled: false\nmeta: 动态说明\n'], signal)
      expect(result).toMatchObject({ field: 'metadata', version: 2, modified: true })
      expect((await f.store.getResource(f.resource.id))!.rootNode.children!.find(node => node.id === 'personality'))
        .toMatchObject({ label: '新人设', enabled: false, meta: '动态说明' })
    } finally { f.engine.close() }
  })

  it('rejects Metadata patches without overwriting the node body', async () => {
    const f = await fixture()
    const path = '/resources/爱丽丝/人设.md.meta.yaml'
    try {
      const before = await f.store.getResource(f.resource.id)
      await f.fs.read([path], signal)
      const patch = `--- ${path}\n+++ ${path}\n@@ -1 +1 @@\n-label: 人设\n+label: 新人设\n`
      await expect(f.fs.patch([path, patch], signal)).rejects.toMatchObject({ code: 'vfs.write_unsupported' })
      expect(await f.store.getResource(f.resource.id)).toEqual(before)
    } finally { f.engine.close() }
  })

  it('rejects unsupported Metadata fields before the domain mutation', async () => {
    const f = await fixture()
    const path = '/resources/爱丽丝/人设.md.meta.yaml'
    try {
      await f.fs.read([path], signal)
      await expect(f.fs.write([path, 'parentId: hacked\n'], signal))
        .rejects.toMatchObject({ code: 'vfs.metadata_invalid' })
      expect((await f.store.getResource(f.resource.id))!.version).toBe(1)
    } finally { f.engine.close() }
  })

  it('moves an existing node inside one resource after reading its Metadata', async () => {
    const f = await fixture()
    try {
      await f.store.mutateResource({
        actor: { kind: 'kernel', id: 'user' }, resourceId: f.resource.id, expectedVersion: 1,
        mutations: [{ kind: 'node.create', parentId: 'root', node: { id: 'folder', kind: 'folder', label: '文件夹' } }],
      })
      const path = '/resources/爱丽丝/人设.md'
      const parent = '/resources/爱丽丝/文件夹'
      await f.fs.read(['/resources/爱丽丝/人设.md.meta.yaml'], signal)
      await f.fs.read([`${parent}/@meta.yaml`], signal)
      const result = await f.fs.move([path, parent, 0], signal)
      expect(result).toMatchObject({ modified: true, version: 3 })
      const resource = await f.store.getResource(f.resource.id)
      expect(resource!.rootNode.children!.find(node => node.id === 'folder')!.children)
        .toMatchObject([{ id: 'personality', label: '人设' }])
    } finally { f.engine.close() }
  })

  it('deletes a node subtree after reading Metadata and refuses the resource root', async () => {
    const f = await fixture()
    try {
      const path = '/resources/爱丽丝/人设.md'
      await f.fs.read(['/resources/爱丽丝/人设.md.meta.yaml'], signal)
      const result = await f.fs.delete([path], signal)
      expect(result).toMatchObject({ modified: true, version: 2 })
      expect((await f.store.getResource(f.resource.id))!.rootNode.children!.some(node => node.id === 'personality')).toBe(false)
      await f.fs.read(['/resources/爱丽丝/@meta.yaml'], signal)
      await expect(f.fs.delete(['/resources/爱丽丝'], signal)).rejects.toMatchObject({ code: 'vfs.root_delete' })
    } finally { f.engine.close() }
  })

  it('creates a new node with a host-generated identity after reading the parent Metadata', async () => {
    const f = await fixture()
    try {
      await f.fs.read(['/resources/爱丽丝/@meta.yaml'], signal)
      const result = await f.fs.create(['/resources/爱丽丝', {
        label: '新条目', kind: 'entry', body: '由 Agent 创建', enabled: true,
      }], signal)
      expect(result).toMatchObject({ parentPath: '/resources/爱丽丝', version: 2, modified: true })
      expect(result).not.toHaveProperty('id')
      expect((await f.store.getResource(f.resource.id))!.rootNode.children)
        .toEqual(expect.arrayContaining([expect.objectContaining({ label: '新条目', body: '由 Agent 创建' })]))
    } finally { f.engine.close() }
  })

  it('copies a node subtree with new identities after reading source and destination Metadata', async () => {
    const f = await fixture()
    try {
      await f.fs.read(['/resources/爱丽丝/人设.md.meta.yaml'], signal)
      await f.fs.read(['/resources/爱丽丝/@meta.yaml'], signal)
      const result = await f.fs.copy([
        '/resources/爱丽丝/人设.md',
        '/resources/爱丽丝',
        { name: '复制人设' },
      ], signal)
      expect(result).toMatchObject({
        sourcePath: '/resources/爱丽丝/人设.md',
        destinationPath: '/resources/爱丽丝',
        nodeCount: 1,
        modified: true,
        version: 2,
      })
      const resource = await f.store.getResource(f.resource.id)
      expect(resource!.rootNode.children).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'personality', label: '人设' }),
        expect.objectContaining({ label: '复制人设', body: '作者源码 {{name}}\n第二行' }),
      ]))
      const copied = resource!.rootNode.children!.find(node => node.label === '复制人设')
      expect(copied?.id).not.toBe('personality')
    } finally { f.engine.close() }
  })

  it('duplicates a whole Prompt Resource when the source is a resource root', async () => {
    const f = await fixture()
    try {
      await f.fs.read(['/resources/爱丽丝/@meta.yaml'], signal)
      const result = await f.fs.copy([
        '/resources/爱丽丝',
        '/resources',
        { name: '爱丽丝副本' },
      ], signal)
      expect(result).toMatchObject({
        sourcePath: '/resources/爱丽丝',
        destinationPath: '/resources',
        resourceId: `${f.resource.id}-copy`,
        label: '爱丽丝副本',
        resource: true,
        modified: true,
      })
    } finally { f.engine.close() }
  })

  it('rejects cross-resource node copy and copy without a structural read baseline', async () => {
    const f = await fixture()
    try {
      await expect(f.fs.copy(['/resources/爱丽丝/人设.md', '/resources/爱丽丝'], signal))
        .rejects.toMatchObject({ code: 'vfs.read_required' })
      const other = await f.store.createResource({
        actor: { kind: 'kernel', id: 'test' },
        resourceKind: 'setting',
        rootNode: { id: 'other-root', label: '其他', kind: 'module' },
      })
      const fs = createResourceVfs({
        projections: [],
        resources: {
          store: f.store,
          ids: [f.resource.id, other.resource.id],
          access: f.access,
          copyNode: async input => {
            throw new Error(`unexpected copy: ${input.sourceNodeId}`)
          },
        },
      })
      await fs.read(['/resources/爱丽丝/人设.md.meta.yaml'], signal)
      await fs.read(['/resources/其他/@meta.yaml'], signal)
      await expect(fs.copy([
        '/resources/爱丽丝/人设.md',
        '/resources/其他',
      ], signal)).rejects.toMatchObject({ code: 'vfs.cross_resource' })
    } finally { f.engine.close() }
  })

  it('sends a structured preview to approval and does not persist a denied mutation', async () => {
    const f = await fixture()
    const previews: unknown[] = []
    const path = '/resources/爱丽丝/人设.md'
    const approved = createResourceVfs({
      projections: [],
      resources: {
        store: f.store, ids: [f.resource.id], access: f.access,
        write: async input => {
          const result = await f.store.mutateResource({
            actor: { kind: 'kernel', id: 'codeact' }, resourceId: input.resourceId,
            expectedVersion: input.expectedVersion,
            mutations: [{ kind: 'node.update', nodeId: input.nodeId, patch: { body: input.body } }],
          })
          return { version: result.resource.version, changesetId: result.commit.changesetId }
        },
      },
      approveMutation: async preview => {
        previews.push(preview)
        return { decision: 'allow' }
      },
    })
    const denied = createResourceVfs({
      projections: [],
      resources: {
        store: f.store, ids: [f.resource.id], access: f.access,
        write: async input => {
          const result = await f.store.mutateResource({
            actor: { kind: 'kernel', id: 'codeact' }, resourceId: input.resourceId,
            expectedVersion: input.expectedVersion,
            mutations: [{ kind: 'node.update', nodeId: input.nodeId, patch: { body: input.body } }],
          })
          return { version: result.resource.version, changesetId: result.commit.changesetId }
        },
      },
      approveMutation: async () => ({ decision: 'deny', reason: '用户拒绝本次修改' }),
    })
    try {
      await approved.read([path], signal)
      await approved.write([path, '预览后允许'], signal)
      expect(previews).toEqual([{
        action: 'replace', path, kind: 'prompt-resource',
        before: '作者源码 {{name}}\n第二行', after: '预览后允许',
      }])
      await denied.read([path], signal)
      await expect(denied.write([path, '不应写入'], signal))
        .rejects.toMatchObject({ code: 'vfs.denied', message: '用户拒绝本次修改' })
      expect((await f.store.getResource(f.resource.id))!.version).toBe(2)
      expect((await f.store.getResource(f.resource.id))!.rootNode.children!.find(node => node.id === 'personality')!.body)
        .toBe('预览后允许')
    } finally { f.engine.close() }
  })

  it('rejects write without a full current baseline and rejects stale resource versions', async () => {
    const f = await fixture()
    try {
      const path = '/resources/爱丽丝/人设.md'
      await expect(f.fs.write([path, '没有先读'], signal)).rejects.toMatchObject({ code: 'vfs.read_required' })
      await f.fs.read([path, { startLine: 1, endLine: 1 }], signal)
      await expect(f.fs.write([path, '不能用部分读取覆盖'], signal)).rejects.toMatchObject({ code: 'vfs.full_read_required' })
      await f.fs.read([path], signal)
      await f.store.mutateResource({
        actor: { kind: 'kernel', id: 'user' }, resourceId: f.resource.id, expectedVersion: f.resource.version,
        mutations: [{ kind: 'node.update', nodeId: 'personality', patch: { body: '用户先改了' } }],
      })
      await expect(f.fs.write([path, '不能覆盖用户修改'], signal)).rejects.toMatchObject({ code: 'vfs.baseline_changed' })
    } finally { f.engine.close() }
  })

  it.each(['replace', 'patch'] as const)('does not persist %s if cancelled during approval', async action => {
    const controller = new AbortController()
    const f = await fixture('旧句', async (_preview, approvalSignal) => {
      expect(approvalSignal).toBe(controller.signal)
      controller.abort()
      return { decision: 'allow' }
    })
    const path = '/resources/爱丽丝/人设.md'
    try {
      await f.fs.read([path], controller.signal)
      const operation = action === 'replace'
        ? f.fs.write([path, '新句'], controller.signal)
        : f.fs.patch([path, `--- ${path}\n+++ ${path}\n@@ -1 +1 @@\n-旧句\n+新句\n`], controller.signal)
      await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
      expect(await f.store.getResource(f.resource.id)).toMatchObject({ version: 1 })
    } finally { f.engine.close() }
  })

  it('preserves user edits made while approval is pending', async () => {
    const f = await fixture('旧句', async () => {
      await f.store.mutateResource({
        actor: { kind: 'kernel', id: 'user' }, resourceId: f.resource.id, expectedVersion: 1,
        mutations: [{ kind: 'node.update', nodeId: 'personality', patch: { body: '用户的新句' } }],
      })
      return { decision: 'allow' }
    })
    const path = '/resources/爱丽丝/人设.md'
    try {
      await f.fs.read([path], signal)
      await expect(f.fs.write([path, 'Agent的新句'], signal)).rejects.toThrow()
      expect((await f.fs.read([path], signal)).text).toBe('用户的新句')
      expect(await f.store.getResource(f.resource.id)).toMatchObject({ version: 2 })
    } finally { f.engine.close() }
  })

  it('patches only read ranges by unique context even with offset line hints', async () => {
    const f = await fixture('开头\n旧句\n中间\n尾句\n结尾')
    const path = '/resources/爱丽丝/人设.md'
    try {
      await f.fs.read([path, { startLine: 2, endLine: 2 }], signal)
      await f.fs.read([path, { startLine: 4, endLine: 4 }], signal)
      const patch = `--- ${path}\n+++ ${path}\n@@ -99 +99 @@\n-旧句\n+新句\n@@ -110 +110 @@\n-尾句\n+新尾句\n`
      expect(await f.fs.patch([path, patch], signal)).toMatchObject({ modified: true, version: 2 })
      expect((await f.fs.read([path], signal)).text).toBe('开头\n新句\n中间\n新尾句\n结尾')
    } finally { f.engine.close() }
  })

  it.each([
    ['vfs.patch_ambiguous', '@@ -1 +1 @@\n-重复\n+改写\n'],
    ['vfs.patch_context_required', '@@ -0,0 +1 @@\n+插入\n'],
    ['vfs.patch_context_mismatch', '@@ -2 +2 @@\n-中间\n+改写\n@@ -8 +8 @@\n-不存在\n+失败\n'],
    ['vfs.patch_overlap', '@@ -2 +2 @@\n-中间\n+改写\n@@ -2 +2 @@\n-中间\n+重复改写\n'],
    ['vfs.patch_invalid', '@@ -2,3 +2 @@\n-中间\n+改写\n'],
  ])('rejects %s without persisting any patch blocks', async (code, blocks) => {
    const f = await fixture('重复\n中间\n重复\n结尾')
    const path = '/resources/爱丽丝/人设.md'
    try {
      await f.fs.read([path], signal)
      await expect(f.fs.patch([path, `--- ${path}\n+++ ${path}\n${blocks}`], signal))
        .rejects.toMatchObject({ code })
      expect(await f.store.getResource(f.resource.id)).toMatchObject({ version: 1 })
      expect((await f.fs.read([path], signal)).text).toBe('重复\n中间\n重复\n结尾')
    } finally { f.engine.close() }
  })

  it('requires reads, refuses unread text and stale versions, and permits a new patch after rereading', async () => {
    const f = await fixture()
    const path = '/resources/爱丽丝/人设.md'
    const patch = `--- ${path}\n+++ ${path}\n@@ -2 +2 @@\n-第二行\n+已改第二行\n`
    try {
      await expect(f.fs.patch([path, patch], signal)).rejects.toMatchObject({ code: 'vfs.read_required' })
      await f.fs.read([path, { startLine: 1, endLine: 1 }], signal)
      await expect(f.fs.patch([path, patch], signal)).rejects.toMatchObject({ code: 'vfs.patch_range_not_read' })
      await f.fs.read([path, { startLine: 2, endLine: 2 }], signal)
      await f.store.mutateResource({
        actor: { kind: 'kernel', id: 'user' }, resourceId: f.resource.id, expectedVersion: 1,
        mutations: [{ kind: 'node.update', nodeId: 'personality', patch: { body: '用户改第一行\n第二行' } }],
      })
      await expect(f.fs.patch([path, patch], signal)).rejects.toMatchObject({ code: 'vfs.baseline_changed' })
      await f.fs.read([path, { startLine: 2, endLine: 2 }], signal)
      await f.fs.patch([path, patch], signal)
      expect((await f.fs.read([path], signal)).text).toBe('用户改第一行\n已改第二行')
    } finally { f.engine.close() }
  })

  it.each(['保留末尾换行\n', '没有末尾换行'])('preserves EOF when patching %j', async before => {
    const f = await fixture(before)
    const path = '/resources/爱丽丝/人设.md'
    try {
      await f.fs.read([path], signal)
      await f.fs.patch([path, `--- ${path}\n+++ ${path}\n@@ -1 +1 @@\n-${before.trimEnd()}\n+新句\n`], signal)
      expect((await f.fs.read([path], signal)).text).toBe(`新句${before.endsWith('\n') ? '\n' : ''}`)
    } finally { f.engine.close() }
  })

  it('retains host read observations across separate CodeAct invocations without sharing JS state', async () => {
    const f = await fixture()
    try {
      const scope: ToolExecutionScope = { context: [], resourceVfs: f.fs }
      await createCodeActContext(scope).methods.read(['/resources/爱丽丝/人设.md'], signal)
      createCodeActContext(scope)
      expect(scope.resourceVfs?.observation('/resources/爱丽丝/人设.md')?.binding)
        .toMatchObject({ kind: 'prompt-resource', nodeId: 'personality' })
    } finally { f.engine.close() }
  })

  it('projects arbitrary State paths as YAML without assuming a fixed entity collection name', async () => {
    let value: JsonObject = { world: { persons: { C: { components: { inventory: { items: ['key'] } } } } }, 'a/b': 3 }
    let revisionId = 'r1'
    let allowed = true
    const fs = createResourceVfs({
      projections: [], state: {
        target: { scope: 'timeline', timelineId: 't', branchId: 'b' },
        canAccess: () => allowed, read: async () => ({ revisionId, value }),
      },
    })
    expect(await fs.ls(['/state/data/world/persons/C/components'], signal)).toContain('inventory/')
    const path = '/state/data/world/persons/C/components/inventory/@value.yaml'
    const result = await fs.read([path], signal)
    expect(result.text).toBe('items:\n  - key\n')
    expect(result.observation.binding).toMatchObject({ pointer: '/world/persons/C/components/inventory', revisionId: 'r1' })
    expect((await fs.read(['/state/data/a%2Fb/@value.yaml'], signal)).observation.binding).toMatchObject({ pointer: '/a~1b' })
    value = { world: { persons: { C: { components: { inventory: { items: [] } } } } } }
    revisionId = 'r2'
    expect((await fs.read([path], signal)).observation.binding).toMatchObject({ revisionId: 'r2' })
    allowed = false
    await expect(fs.read([path], signal)).rejects.toMatchObject({ code: 'vfs.not_found' })
  })

  it('writes a State property with revision compare-and-set, but not the complete snapshot', async () => {
    let value: JsonObject = { world: { persons: { C: { inventory: { key: false } } } } }
    let revisionId = 'r1'
    const fs = createResourceVfs({
      projections: [],
      state: {
        target: { scope: 'timeline', timelineId: 't', branchId: 'b' },
        canAccess: () => true,
        read: async () => ({ revisionId, value }),
        write: async input => {
          expect(input.pointer).toBe('/world/persons/C/inventory/key')
          expect(input.expectedRevisionId).toBe(revisionId)
          value = { world: { persons: { C: { inventory: { key: input.value } } } } }
          revisionId = 'r2'
          return { revisionId, changesetId: 'change-state-1' }
        },
      },
      approveMutation: async preview => {
        expect(preview).toMatchObject({
          action: 'replace', path,
          kind: 'state', before: 'false\n', after: 'true\n',
          pointer: '/world/persons/C/inventory/key',
        })
        return { decision: 'allow' }
      },
    })
    const path = '/state/data/world/persons/C/inventory/key/@value.yaml'
    await fs.read([path], signal)
    const result = await fs.write([path, true as JsonValue], signal)
    expect(result).toMatchObject({ revisionId: 'r2', changesetId: 'change-state-1', modified: true })
    await fs.read(['/state/current.yaml'], signal)
    await expect(fs.write(['/state/current.yaml', '{}'], signal)).rejects.toMatchObject({ code: 'vfs.write_unsupported' })
  })

  it('loads explicitly provided attachments only when reading, never when listing', async () => {
    let reads = 0
    const fs = createResourceVfs({
      projections: [],
      attachments: async () => [{
        identity: 'attachment-1', name: 'README.md',
        binding: { kind: 'script', documentId: 'doc', version: 2, blobId: 'blob', mountId: 'mount' },
        read: async () => { reads++; return '# Read me' },
      }],
    })
    expect(await fs.ls(['/attachments'], signal)).toContain('README.md')
    expect(reads).toBe(0)
    const result = await fs.read(['/attachments/README.md'], signal)
    expect(result.text).toBe('# Read me')
    expect(result.observation.binding).toMatchObject({ blobId: 'blob', version: 2 })
    expect(reads).toBe(1)
  })
})
