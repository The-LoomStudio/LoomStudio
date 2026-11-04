import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ExtensionRecoveryRecord } from '@loom-studio/kernel'

export async function listExtensionRecoveryRecords(installedDirectory: string): Promise<{ records: ExtensionRecoveryRecord[] }> {
  const root = resolve(installedDirectory)
  let canonicalRoot: string
  try { canonicalRoot = await realpath(root) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { records: [] }; throw error }
  const history = join(root, '.history')
  const inside = (path: string, boundary = root) => { const rel = relative(boundary, path); return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) }
  async function validatePath(path: string): Promise<void> {
    const absolute = resolve(path)
    if (!isAbsolute(path) || !inside(absolute)) throw new Error(`Recovery path is outside installation root: ${path}`)
    let existing = absolute
    for (;;) {
      try {
        if (!inside(await realpath(existing), canonicalRoot)) throw new Error(`Recovery path escapes installation root: ${path}`)
        return
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        const parent = dirname(existing)
        if (parent === existing) throw error
        existing = parent
      }
    }
  }
  let names: string[]
  try { await validatePath(history); names = await readdir(history) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { records: [] }; throw error }
  const records = await Promise.all(names.filter(name => name.endsWith('.recovery.json')).sort().map(async name => {
    const recordPath = join(history, name)
    const record: ExtensionRecoveryRecord = { id: basename(name, '.recovery.json'), recordPath, valid: false }
    try {
      if ((await lstat(recordPath)).isSymbolicLink()) throw new Error('Recovery record must not be a symbolic link')
      await validatePath(recordPath)
      const value: unknown = JSON.parse(await readFile(recordPath, 'utf8'))
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid recovery record object')
      const data = value as Record<string, unknown>
      for (const key of ['packageId', 'fromVersion', 'toVersion', 'stage', 'backupDirectory', 'historyDirectory', 'destination', 'message'] as const) {
        if (data[key] !== undefined && typeof data[key] !== 'string') throw new Error(`Invalid recovery field: ${key}`)
        if (typeof data[key] === 'string') record[key] = data[key]
      }
      if (data.version !== 1 || !record.packageId || !record.backupDirectory || !record.historyDirectory || !record.destination) throw new Error('Incomplete recovery record')
      for (const path of [record.backupDirectory, record.historyDirectory, record.destination]) await validatePath(path)
      if (data.recordPath !== undefined && data.recordPath !== recordPath) throw new Error('Recovery record path mismatch')
      if (typeof data.failedStage === 'string') record.stage = data.failedStage
      record.valid = true
    } catch (error) { record.message = error instanceof Error ? error.message : String(error) }
    return record
  }))
  return { records }
}
