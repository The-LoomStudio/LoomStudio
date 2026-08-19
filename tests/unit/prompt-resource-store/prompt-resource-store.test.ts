import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createPromptResourceStore, type PromptResourceTreeNode } from '@loom-studio/prompt-resource-store'
import { describe, expect, it } from 'vitest'

const actor = { kind: 'system' as const, id: 'prompt-resource-test' }

describe('PromptResourceStore', () => {
  it('characterizes V1 nested trees through flatten/read round-trip and node revisions', async () => {
    const { engine, store } = createStore()
    const settingFixture = createV1NestedFixture('setting-root', 'setting', 500)
    const presetFixture = createV1NestedFixture('preset-root', 'preset', 100)

    const setting = await store.createResource({ actor, id: 'setting-500', resourceKind: 'setting', rootNode: settingFixture })
    const preset = await store.createResource({ actor, id: 'preset-100', resourceKind: 'preset', rootNode: presetFixture })

    expect(engine.database.prepare('SELECT version FROM schema_migrations WHERE namespace = ?').get('application.prompt-resource')).toEqual({ version: 1 })
    expect(engine.database.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND (name LIKE 'prompt_resource%' OR name = 'global_setting_mounts')`).all()).toEqual(expect.arrayContaining([
      { name: 'prompt_resources' },
      { name: 'prompt_resource_nodes' },
      { name: 'global_setting_mounts' },
      { name: 'prompt_resource_node_revisions' },
      { name: 'prompt_resource_header_revisions' },
    ]))

    expect(setting.resource.rootNode).toEqual(settingFixture)
    expect(preset.resource.rootNode).toEqual(presetFixture)
    expect(setting.resource.version).toBe(1)
    expect(preset.resource.version).toBe(1)

    const updated = await store.mutateResource({
      actor,
      resourceId: setting.resource.id,
      expectedVersion: 1,
      mutations: [{ kind: 'node.update', nodeId: 'setting-entry-250', patch: { body: 'Updated V1 entry.' } }],
    })
    expect(updated.resource.rootNode.children?.[249]?.body).toBe('Updated V1 entry.')
    expect(engine.database.prepare('SELECT COUNT(*) AS count FROM prompt_resource_node_revisions WHERE resource_id = ? AND resource_version = 2').get(setting.resource.id)).toEqual({ count: 1 })

    await store.addSettingMount({ actor, settingResourceId: setting.resource.id, source: { kind: 'manual' }, orderIndex: 0 })
    await store.addSettingMount({ actor, settingResourceId: setting.resource.id, source: { kind: 'preset', id: preset.resource.id }, orderIndex: 1 })
    expect((await store.listSettingMounts({ settingResourceId: setting.resource.id })).map(mount => mount.source)).toEqual([
      { kind: 'manual', id: 'global' },
      { kind: 'preset', id: preset.resource.id },
    ])
    engine.close()
  })

  it('validates ownership, root rules, cycles, and failed batches before writing', async () => {
    const { engine, store } = createStore()
    const resource = await store.createResource({ actor, resourceKind: 'setting', rootNode: createSmallTree() })
    const commits: unknown[] = []
    engine.subscribeCommits(commit => commits.push(commit))

    await expect(store.mutateResource({
      actor,
      resourceId: resource.resource.id,
      expectedVersion: 1,
      mutations: [{ kind: 'node.move', nodeId: 'entry-a', parentId: 'entry-b', orderIndex: 0 }],
    })).rejects.toMatchObject({ code: 'prompt_resource.parent_invalid' })

    await expect(store.mutateResource({
      actor,
      resourceId: resource.resource.id,
      expectedVersion: 1,
      mutations: [{ kind: 'node.move', nodeId: 'folder-a', parentId: 'folder-a', orderIndex: 0 }],
    })).rejects.toMatchObject({ code: 'prompt_resource.cycle' })

    await expect(store.mutateResource({
      actor,
      resourceId: resource.resource.id,
      expectedVersion: 1,
      mutations: [{ kind: 'node.move', nodeId: 'folder-a', parentId: 'entry-a', orderIndex: 0 }],
    })).rejects.toMatchObject({ code: 'prompt_resource.parent_invalid' })

    await expect(store.mutateResource({
      actor,
      resourceId: resource.resource.id,
      expectedVersion: 1,
      mutations: [{ kind: 'node.delete', nodeId: 'root' }],
    })).rejects.toMatchObject({ code: 'prompt_resource.root_delete_invalid' })

    await expect(store.mutateResource({
      actor,
      resourceId: resource.resource.id,
      expectedVersion: 1,
      mutations: [
        { kind: 'node.update', nodeId: 'entry-a', patch: { body: 'must roll back' } },
        { kind: 'node.move', nodeId: 'entry-b', parentId: 'missing-parent', orderIndex: 0 },
      ],
    })).rejects.toMatchObject({ code: 'prompt_resource.node_not_found' })

    const unchanged = await store.getResource(resource.resource.id)
    expect(findNode(unchanged?.rootNode, 'entry-a')).toMatchObject({ id: 'entry-a', body: 'A' })
    expect(unchanged?.version).toBe(1)
    expect(engine.database.prepare('SELECT COUNT(*) AS count FROM prompt_resource_node_revisions WHERE resource_id = ?').get(resource.resource.id)).toEqual({ count: 4 })
    expect(engine.database.prepare('SELECT COUNT(*) AS count FROM changesets').get()).toEqual({ count: 1 })
    expect(commits).toEqual([])
    engine.close()
  })

  it('rejects expected-version conflicts, semantic no-ops, invalid runtime values, and foreign parents', async () => {
    const { engine, store } = createStore()
    const resource = await store.createResource({ actor, resourceKind: 'setting', rootNode: createSmallTree(), metadata: { mode: 'one' } })
    const other = await store.createResource({ actor, id: 'other-resource', resourceKind: 'setting', rootNode: createSmallTree('other-root', 'other') })

    await expect(store.mutateResource({ actor, resourceId: resource.resource.id, expectedVersion: 2, mutations: [{ kind: 'node.update', nodeId: 'entry-a', patch: { body: 'A2' } }] })).rejects.toMatchObject({ code: 'prompt_resource.conflict' })
    await expect(store.mutateResource({ actor, resourceId: resource.resource.id, expectedVersion: 1, mutations: [{ kind: 'node.update', nodeId: 'entry-a', patch: { body: 'A' } }] })).rejects.toMatchObject({ code: 'prompt_resource.noop' })
    await expect(store.mutateResource({ actor, resourceId: resource.resource.id, expectedVersion: 1, mutations: [{ kind: 'node.move', nodeId: 'entry-a', parentId: 'folder-a', orderIndex: 0 }] })).rejects.toMatchObject({ code: 'prompt_resource.noop' })
    await expect(store.mutateResource({ actor, resourceId: resource.resource.id, expectedVersion: 1, mutations: [{ kind: 'resource.update', patch: {} }] })).rejects.toMatchObject({ code: 'prompt_resource.noop' })
    await expect(store.mutateResource({ actor, resourceId: resource.resource.id, expectedVersion: 1, mutations: [{ kind: 'resource.update', patch: { label: 'Root', metadata: { mode: 'one' } } }] })).rejects.toMatchObject({ code: 'prompt_resource.noop' })
    await expect(store.mutateResource({ actor, resourceId: resource.resource.id, expectedVersion: 1, mutations: [{ kind: 'node.create', parentId: other.resource.rootNodeId, node: { id: 'foreign-child', kind: 'entry', label: 'Foreign' } }] })).rejects.toMatchObject({ code: 'prompt_resource.node_not_found' })
    await expect(store.mutateResource({ actor, resourceId: resource.resource.id, expectedVersion: 1, mutations: [{ kind: 'node.create', parentId: 'folder-a', node: { id: 'bad-kind', kind: 'invalid' as never, label: 'Invalid' } }] })).rejects.toMatchObject({ code: 'prompt_resource.kind_invalid' })

    const cyclic = {} as { self?: unknown }
    cyclic.self = cyclic
    await expect(store.mutateResource({ actor, resourceId: resource.resource.id, expectedVersion: 1, mutations: [{ kind: 'node.update', nodeId: 'entry-a', patch: { capabilities: cyclic as never } }] })).rejects.toMatchObject({ code: 'prompt_resource.json_invalid' })
    await expect(store.mutateResource({ actor, resourceId: resource.resource.id, expectedVersion: 1, mutations: [{ kind: 'node.update', nodeId: 'entry-a', patch: { extra: [] as never } }] })).rejects.toMatchObject({ code: 'prompt_resource.json_invalid' })
    await expect(store.replaceSettingMounts({ actor, source: { kind: 'manual' }, mounts: [{ settingResourceId: resource.resource.id, orderIndex: 0, origin: cyclic as never }] })).rejects.toMatchObject({ code: 'prompt_resource.json_invalid' })
    await expect(store.mutateResource({ actor, resourceId: resource.resource.id, expectedVersion: 1, mutations: [{ kind: 'resource.update', patch: { metadata: null as never } }] })).rejects.toMatchObject({ code: 'prompt_resource.json_invalid' })
    await expect(store.getResource(resource.resource.id)).resolves.toMatchObject({ version: 1 })
    engine.close()
  })

  it('uses JSON null to clear optional node fields and rejects clearing an already absent value', async () => {
    const { engine, store } = createStore()
    const resource = await store.createResource({ actor, resourceKind: 'setting', rootNode: createSmallTree() })
    const configured = await store.mutateResource({
      actor,
      resourceId: resource.resource.id,
      expectedVersion: 1,
      mutations: [{
        kind: 'node.update',
        nodeId: 'entry-a',
        patch: {
          category: 'setting',
          meta: 'metadata',
          enabled: true,
          body: 'configured',
          capabilities: { projection: { zoneId: 'setting.stable' } },
          extra: { source: 'test' },
        },
      }],
    })
    expect(findNode(configured.resource.rootNode, 'entry-a')).toMatchObject({ category: 'setting', meta: 'metadata', enabled: true, body: 'configured', capabilities: { projection: { zoneId: 'setting.stable' } }, extra: { source: 'test' } })

    const cleared = await store.mutateResource({
      actor,
      resourceId: resource.resource.id,
      expectedVersion: 2,
      mutations: [{
        kind: 'node.update',
        nodeId: 'entry-a',
        patch: { category: null, meta: null, enabled: null, body: null, capabilities: null, extra: null },
      }],
    })
    expect(findNode(cleared.resource.rootNode, 'entry-a')).toEqual({ id: 'entry-a', label: 'A', kind: 'entry' })
    await expect(store.mutateResource({ actor, resourceId: resource.resource.id, expectedVersion: 3, mutations: [{ kind: 'node.update', nodeId: 'entry-a', patch: { body: null, meta: null, enabled: null, capabilities: null, extra: null } }] })).rejects.toMatchObject({ code: 'prompt_resource.noop' })
    engine.close()
  })

  it('increments once for a batch and reverts create, update, move, and delete domains', async () => {
    const { engine, store } = createStore()
    const resource = await store.createResource({ actor, resourceKind: 'setting', rootNode: createSmallTree() })
    const updated = await store.mutateResource({
      actor,
      resourceId: resource.resource.id,
      expectedVersion: 1,
      mutations: [
        { kind: 'node.update', nodeId: 'entry-a', patch: { body: 'A2' } },
        { kind: 'node.update', nodeId: 'entry-b', patch: { label: 'B2' } },
      ],
    })
    expect(updated.resource.version).toBe(2)
    expect(engine.database.prepare('SELECT COUNT(*) AS count FROM prompt_resource_node_revisions WHERE resource_id = ? AND resource_version = 2').get(resource.resource.id)).toEqual({ count: 2 })
    await store.revertChangeset({ actor, changesetId: updated.commit.changesetId })
    const revertedUpdate = await store.getResource(resource.resource.id)
    expect(findNode(revertedUpdate?.rootNode, 'entry-a')).toMatchObject({ id: 'entry-a', body: 'A' })
    expect(findNode(revertedUpdate?.rootNode, 'entry-b')).toMatchObject({ id: 'entry-b', label: 'B' })
    expect(revertedUpdate?.version).toBe(3)

    const moved = await store.mutateResource({ actor, resourceId: resource.resource.id, expectedVersion: 3, mutations: [{ kind: 'node.move', nodeId: 'entry-a', parentId: 'root', orderIndex: 0 }] })
    await store.revertChangeset({ actor, changesetId: moved.commit.changesetId })
    const revertedMove = await store.getResource(resource.resource.id)
    expect(revertedMove?.rootNode.children?.[0]?.id).toBe('folder-a')
    expect(findNode(revertedMove?.rootNode, 'entry-a')).toMatchObject({ id: 'entry-a' })

    const created = await store.mutateResource({
      actor,
      resourceId: resource.resource.id,
      expectedVersion: 5,
      mutations: [
        { kind: 'node.create', parentId: 'root', node: { id: 'new-folder', kind: 'folder', label: 'New Folder' } },
        { kind: 'node.create', parentId: 'new-folder', node: { id: 'new-entry', kind: 'entry', label: 'New Entry', body: 'new' } },
      ],
    })
    const deleted = await store.mutateResource({ actor, resourceId: resource.resource.id, expectedVersion: created.resource.version, mutations: [{ kind: 'node.delete', nodeId: 'new-folder' }] })
    await store.revertChangeset({ actor, changesetId: deleted.commit.changesetId })
    const revertedDelete = await store.getResource(resource.resource.id)
    expect(findNode(revertedDelete?.rootNode, 'new-folder')).toMatchObject({ id: 'new-folder' })
    expect(findNode(revertedDelete?.rootNode, 'new-entry')).toMatchObject({ id: 'new-entry', body: 'new' })
    engine.close()
  })

  it('reverts and redoes header-only and header-plus-node changes completely', async () => {
    const { engine, store } = createStore()
    const resource = await store.createResource({ actor, resourceKind: 'setting', rootNode: createSmallTree(), metadata: { mode: 'one' } })

    const headerOnly = await store.mutateResource({ actor, resourceId: resource.resource.id, expectedVersion: 1, mutations: [{ kind: 'resource.update', patch: { label: 'Header One', metadata: { mode: 'two' } } }] })
    const undoneHeader = await store.revertChangeset({ actor, changesetId: headerOnly.commit.changesetId })
    expect(undoneHeader.resource).toMatchObject({ version: 3, label: 'Root', metadata: { mode: 'one' } })
    const redoneHeader = await store.revertChangeset({ actor, changesetId: undoneHeader.commit.changesetId })
    expect(redoneHeader.resource).toMatchObject({ version: 4, label: 'Header One', metadata: { mode: 'two' } })

    const mixed = await store.mutateResource({
      actor,
      resourceId: resource.resource.id,
      expectedVersion: 4,
      mutations: [
        { kind: 'resource.update', patch: { label: 'Mixed Header', metadata: { mode: 'three' } } },
        { kind: 'node.update', nodeId: 'entry-a', patch: { body: 'A2' } },
      ],
    })
    const undoneMixed = await store.revertChangeset({ actor, changesetId: mixed.commit.changesetId })
    expect(undoneMixed.resource).toMatchObject({ version: 6, label: 'Header One', metadata: { mode: 'two' } })
    expect(findNode(undoneMixed.resource.rootNode, 'entry-a')).toMatchObject({ body: 'A' })
    const redoneMixed = await store.revertChangeset({ actor, changesetId: undoneMixed.commit.changesetId })
    expect(redoneMixed.resource).toMatchObject({ version: 7, label: 'Mixed Header', metadata: { mode: 'three' } })
    expect(findNode(redoneMixed.resource.rootNode, 'entry-a')).toMatchObject({ body: 'A2' })
    engine.close()
  })

  it('rejects mount-only and mixed-resource changesets instead of partially reverting them', async () => {
    const { engine, store } = createStore()
    const setting = await store.createResource({ actor, id: 'mixed-setting', resourceKind: 'setting', rootNode: createSmallTree('mixed-setting-root', 'mixed-setting') })
    const preset = await store.createResource({ actor, id: 'mixed-preset', resourceKind: 'preset', rootNode: createSmallTree('mixed-preset-root', 'mixed-preset') })
    const mount = await store.addSettingMount({ actor, settingResourceId: setting.resource.id, source: { kind: 'manual' }, orderIndex: 0 })
    await expect(store.revertChangeset({ actor, changesetId: mount.commit.changesetId })).rejects.toMatchObject({ code: 'prompt_resource.mixed_changeset' })

    const mixed = await engine.transact({ actor }, tx => {
      const transaction = store.transaction(tx)
      const resource = transaction.mutateResource({ resourceId: preset.resource.id, expectedVersion: 1, mutations: [{ kind: 'node.update', nodeId: 'mixed-preset-entry-a', patch: { body: 'changed' } }] })
      transaction.addSettingMount({ settingResourceId: setting.resource.id, source: { kind: 'preset', id: preset.resource.id }, orderIndex: 1 })
      return resource
    })
    await expect(store.revertChangeset({ actor, changesetId: mixed.commit.changesetId })).rejects.toMatchObject({ code: 'prompt_resource.mixed_changeset' })
    await expect(store.getResource(preset.resource.id)).resolves.toMatchObject({ version: 2 })
    expect((await store.listSettingMounts({ source: { kind: 'preset', id: preset.resource.id } })).map(item => item.settingResourceId)).toEqual([setting.resource.id])
    engine.close()
  })

  it('supports tombstones and mount replacement in isolated transactions', async () => {
    const { engine, store } = createStore()
    const first = await store.createResource({ actor, id: 'setting-1', resourceKind: 'setting', rootNode: createSmallTree() })
    const second = await store.createResource({ actor, id: 'setting-2', resourceKind: 'setting', rootNode: createSmallTree('root-2', 'second') })
    const firstReplace = await store.replaceSettingMounts({ actor, source: { kind: 'manual' }, mounts: [{ settingResourceId: first.resource.id, orderIndex: 0 }, { settingResourceId: second.resource.id, orderIndex: 1 }] })
    const secondReplace = await store.replaceSettingMounts({ actor, source: { kind: 'manual' }, mounts: [{ settingResourceId: second.resource.id, orderIndex: 3 }] })
    expect(secondReplace.commit.operations).toEqual([
      ...firstReplace.mounts.map(mount => ({ store: 'prompt-resources', kind: 'delete' as const, entityId: mount.id, entityType: 'prompt-resource.mount' })).sort((left, right) => left.entityId.localeCompare(right.entityId)),
      { store: 'prompt-resources', kind: 'create', entityId: secondReplace.mounts[0]!.id, entityType: 'prompt-resource.mount' },
    ])
    expect((await store.listSettingMounts({ source: { kind: 'manual' } })).map(mount => mount.settingResourceId)).toEqual(['setting-2'])

    const firstMount = await store.addSettingMount({ actor, settingResourceId: first.resource.id, source: { kind: 'manual' }, orderIndex: 4 })
    await expect(store.revertChangeset({ actor, changesetId: firstMount.commit.changesetId })).rejects.toMatchObject({ code: 'prompt_resource.mixed_changeset' })

    const deleted = await store.deleteResource({ actor, resourceId: first.resource.id, expectedVersion: 1 })
    await expect(store.getResource(first.resource.id)).resolves.toBeNull()
    await expect(store.getResource(first.resource.id, { includeTombstone: true })).resolves.toMatchObject({ tombstoned: true, version: 2 })
    expect(deleted.commit.operations).toEqual([
      { store: 'prompt-resources', kind: 'delete', entityId: firstMount.mounts[0]!.id, entityType: 'prompt-resource.mount' },
      { store: 'prompt-resources', kind: 'delete', entityId: first.resource.id, entityType: 'prompt-resource', fromVersion: 1, toVersion: 2 },
    ])
    engine.close()
  })
})

function createStore() {
  let id = 0
  let time = 0
  const engine = createSqliteDataEngine({
    filename: ':memory:',
    createId: prefix => `${prefix}-${++id}`,
    now: () => `2026-08-19T00:00:${String(++time).padStart(2, '0')}.000Z`,
  })
  return { engine, store: createPromptResourceStore({ engine }) }
}

function createV1NestedFixture(rootId: string, category: 'setting' | 'preset', count: number): PromptResourceTreeNode {
  return {
    id: rootId,
    label: category === 'setting' ? 'Setting Layer' : 'Preset',
    kind: 'module',
    category,
    children: Array.from({ length: count }, (_, index) => ({
      id: `${category}-entry-${index + 1}`,
      label: `${category} Entry ${index + 1}`,
      kind: 'entry' as const,
      category,
      body: `${category} body ${index + 1}`,
      enabled: true,
    })),
  }
}

function createSmallTree(rootId = 'root', prefix = ''): PromptResourceTreeNode {
  const folderId = prefix ? `${prefix}-folder-a` : 'folder-a'
  const entryAId = prefix ? `${prefix}-entry-a` : 'entry-a'
  const entryBId = prefix ? `${prefix}-entry-b` : 'entry-b'
  return {
    id: rootId,
    label: 'Root',
    kind: 'module',
    children: [{
      id: folderId,
      label: 'Folder A',
      kind: 'folder',
      children: [
        { id: entryAId, label: 'A', kind: 'entry', body: 'A' },
        { id: entryBId, label: 'B', kind: 'entry', body: 'B' },
      ],
    }],
  }
}

function findNode(root: PromptResourceTreeNode | undefined, id: string): PromptResourceTreeNode | undefined {
  if (!root) return undefined
  if (root.id === id) return root
  for (const child of root.children ?? []) {
    const found = findNode(child, id)
    if (found) return found
  }
  return undefined
}
