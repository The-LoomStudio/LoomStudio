import { createHash } from 'node:crypto'
import { lstat, mkdir, realpath, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ExtensionInstallationTarget } from '@loom-studio/extension-sdk'
import type { DocumentStore } from '../document-store/index.js'

export function createExtensionFileData(dataRoot: string, documents: DocumentStore) {
  async function directory(packageId: string, target: ExtensionInstallationTarget): Promise<string> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(packageId)) throw new Error('Invalid extension data owner')
    await mkdir(dataRoot, { recursive: true })
    let parent = await realpath(dataRoot)
    const scope = target.kind === 'global' ? 'global' : `card-${createHash('sha256').update(target.cardId).digest('hex')}`
    for (const segment of ['extensions', packageId, scope]) {
      const path = join(parent, segment)
      try { await mkdir(path, { mode: 0o700 }) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      const info = await lstat(path)
      const resolved = await realpath(path)
      if (info.isSymbolicLink() || !info.isDirectory() || dirname(resolved) !== parent) throw new Error('Extension data directory cannot escape its owner')
      parent = resolved
    }
    return parent
  }

  async function removeGlobal(packageId: string, documentTypes: string[] = []): Promise<void> {
    // SQL ownership is installation-scoped; never remove Card-owned records here.
    let cursor: string | undefined
    const ids: Array<{ id: string; version: number }> = []
    const types = new Set(['airp.extensionConfig', 'airp.extensionRecord', ...documentTypes])
    do {
      const page = await documents.list({ ownerExtensionId: packageId, ownerInstallationId: null, cursor, limit: 200 })
      ids.push(...page.items.filter(item => types.has(item.type)).map(item => ({ id: item.id, version: item.version })))
      cursor = page.nextCursor
    } while (cursor)
    if (ids.length) await documents.transact({ actor: { kind: 'system', id: 'extension-uninstall' }, reason: 'extension.data.delete' }, async tx => {
      for (const item of ids) await tx.delete({ id: item.id, expectedVersion: item.version, actor: { kind: 'system', id: 'extension-uninstall' } })
    })
    await rm(await directory(packageId, { kind: 'global' }), { recursive: true, force: true })
  }
  return { directory, removeGlobal }
}
