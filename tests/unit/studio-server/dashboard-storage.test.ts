import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { resolveLoomStudioLocalPaths } from '../../../apps/studio-server/src/platform/local-paths.js'
import { createStorageSnapshot } from '../../../apps/studio-server/src/statistics/storage-snapshot.js'

it('counts overlapping managed roots once, keeps SQLite sidecars separate and skips linked targets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'loom-storage-'))
  try {
    const paths = resolveLoomStudioLocalPaths({ home: root, environment: {} })
    paths.cacheRoot = join(paths.dataRoot, 'cache')
    await Promise.all([paths.cacheRoot, paths.blobRoot, paths.logRoot].map(path => mkdir(path, { recursive: true })))
    await writeFile(paths.databaseFile, '12345')
    await writeFile(`${paths.databaseFile}-wal`, '123')
    await writeFile(join(paths.cacheRoot, 'cache.bin'), '12')
    await writeFile(join(paths.blobRoot, 'blob.bin'), '1234')
    await symlink(paths.blobRoot, join(paths.dataRoot, 'linked'))
    const scan = createStorageSnapshot(paths, paths.databaseFile)
    const result = await scan()
    expect(result.groups.reduce((sum, row) => sum + row.bytes, 0)).toBe(14)
    expect(result.groups.find(row => row.id === 'database')).toMatchObject({ bytes: 8, files: 2 })
    expect(result.complete).toBe(false)
    expect(result.errors.some(error => error.includes('符号链接'))).toBe(true)
    expect(await scan()).toBe(result)
  } finally { await rm(root, { recursive: true, force: true }) }
})
