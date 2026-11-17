import { describe, expect, it, vi } from 'vitest'
import { createSqliteDataEngine } from '@loom-studio/kernel/data-engine'
import { createPromptResourceStore } from '@loom-studio/application-runtime/data'
import { listResourceCatalog, readMappedResource } from '../../../packages/application-runtime/src/prompt/prompt-resource-mapper.js'

describe('Prompt resource management fault isolation', () => {
  it('keeps healthy resources and unreadable identities without repairing or weakening strict reads', async () => {
    let sequence = 0
    const engine = createSqliteDataEngine({ filename: ':memory:', createId: prefix => `${prefix}-${++sequence}`, now: () => new Date().toISOString() })
    try {
      const store = createPromptResourceStore({ engine })
      for (const id of ['good', 'json', 'macros']) await store.createResource({
        id, resourceKind: 'lore', actor: { kind: 'system', id: 'test' },
        rootNode: { id: `${id}-root`, kind: 'module', label: id },
      })
      engine.database.prepare('UPDATE prompt_resources SET metadata_json = ? WHERE id = ?').run('{broken', 'json')
      engine.database.prepare('UPDATE prompt_resources SET metadata_json = ? WHERE id = ?').run('{"macros":{"bad":123}}', 'macros')
      const result = await listResourceCatalog(store)
      expect(result.resources.map(item => item.id)).toEqual(['good'])
      expect(result.invalidResources).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'json', label: 'json', version: 1, error: expect.stringContaining('JSON') }),
        expect.objectContaining({ id: 'macros', label: 'macros', version: 1, error: expect.any(String) }),
      ]))
      await expect(readMappedResource(store, 'json')).rejects.toThrow()
      await expect(readMappedResource(store, 'macros')).rejects.toThrow()
      expect(engine.database.prepare('SELECT metadata_json FROM prompt_resources WHERE id = ?').get('json')?.metadata_json).toBe('{broken')
      const first = await store.listResourceHeaders({ limit: 1 })
      const second = await store.listResourceHeaders({ limit: 1, cursor: first.nextCursor })
      expect(first.resources[0]?.id).not.toBe(second.resources[0]?.id)
      const read = vi.spyOn(store, 'getResource').mockRejectedValue(new Error('database unavailable'))
      await expect(listResourceCatalog(store)).rejects.toThrow('database unavailable')
      read.mockRestore()
    } finally { await engine.close() }
  })
})
