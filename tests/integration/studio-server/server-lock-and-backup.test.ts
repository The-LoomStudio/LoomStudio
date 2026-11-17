import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { applicationDocumentTypes, extensionInstallationId } from '@loom-studio/application-runtime'
import { ProcessLockError, resolveLoomStudioLocalPaths } from '@loom-studio/kernel/platform'
import { createMemorySecretBackend } from '@loom-studio/kernel/secret-store'
import { createStudioServer } from '../../../apps/studio-server/src/main.js'
import { callRpc } from './helpers.js'

describe('Studio Server dataRoot process lock and SQLite backups', () => {
  it('enforces exclusive ProcessLock on listen() and releases it on close()', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'loom-process-lock-')))
    const localPaths = resolveLoomStudioLocalPaths({ home: root, environment: {} })
    const lockFile = join(localPaths.dataRoot, 'loom.lock')
    const secretBackend = createMemorySecretBackend()
    const first = createStudioServer({ localPaths, secretBackend })
    const second = createStudioServer({ localPaths, secretBackend })

    try {
      const firstAddress = await first.listen(0)
      expect(existsSync(lockFile)).toBe(true)

      const failure = await second.listen(0).then(
        () => undefined,
        error => error,
      )
      expect(failure).toBeInstanceOf(ProcessLockError)
      expect(failure).toMatchObject({
        code: 'server.data_root_locked',
        details: {
          lockFile,
          pid: process.pid,
          port: 0,
        },
      })

      await expect(callRpc(firstAddress.port, 'application.listCards', {})).resolves.toEqual({ cards: [] })

      await first.close()
      expect(existsSync(lockFile)).toBe(false)

      const secondAddress = await second.listen(0)
      expect(existsSync(lockFile)).toBe(true)
      await expect(callRpc(secondAddress.port, 'application.listCards', {})).resolves.toEqual({ cards: [] })
    } finally {
      await second.close().catch(() => {})
      await first.close().catch(() => {})
      await rm(root, { recursive: true, force: true })
    }
  })

  it('creates a pre-migration SQLite backup before Stage 2 state migration and supports dashboard.createBackup', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'loom-sqlite-backups-')))
    const localPaths = resolveLoomStudioLocalPaths({ home: root, environment: {} })
    const secretBackend = createMemorySecretBackend()
    const initial = createStudioServer({ localPaths, secretBackend })
    let migrated: ReturnType<typeof createStudioServer> | undefined

    try {
      const initialAddress = await initial.listen(0)
      await callRpc(initialAddress.port, 'application.createCard', { name: 'Pre-migration Card' })
      await initial.close()

      const backupsDir = join(localPaths.dataRoot, 'backups')
      expect(existsSync(backupsDir)).toBe(false)

      await mkdir(dirname(localPaths.extensionStateFile), { recursive: true })
      await writeFile(localPaths.extensionStateFile, JSON.stringify({
        version: 3,
        packages: {
          'example.legacy': {
            modules: {
              server: {
                enabled: false,
                grants: { 'events.subscribe': [] },
                updatedAt: '2026-01-01T00:00:00.000Z',
              },
            },
          },
        },
      }), 'utf8')

      migrated = createStudioServer({ localPaths, secretBackend })
      const migratedAddress = await migrated.listen(0)

      const preMigrationFiles = (await readdir(backupsDir)).filter(file => file.startsWith('pre-state-migration-'))
      expect(preMigrationFiles).toHaveLength(1)
      const preMigrationPath = join(backupsDir, preMigrationFiles[0]!)
      const preDb = new DatabaseSync(preMigrationPath, { readOnly: true })
      try {
        expect(preDb.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
        expect(preDb.prepare('SELECT installation_id FROM extension_installations').all()).toEqual([])
        const cards = preDb.prepare('SELECT content_json FROM documents WHERE type = ? AND tombstoned = 0').all(applicationDocumentTypes.cardSource) as Array<{ content_json: string }>
        expect(cards.map(row => JSON.parse(row.content_json).name)).toEqual(['Pre-migration Card'])
      } finally {
        preDb.close()
      }

      const expectedInstallationId = extensionInstallationId('example.legacy', { kind: 'global' })
      await callRpc(migratedAddress.port, 'application.createCard', { name: 'Post-migration Card' })

      const backup = await callRpc<{ filename: string; path: string; sizeBytes: number }>(
        migratedAddress.port,
        'dashboard.createBackup',
        {},
      )
      expect(backup.filename).toMatch(/^studio-backup-.*\.sqlite$/)
      expect(backup.path).toBe(join(backupsDir, backup.filename))
      expect(backup.sizeBytes).toBeGreaterThan(0)
      expect((await stat(backup.path)).size).toBe(backup.sizeBytes)

      const manualDb = new DatabaseSync(backup.path, { readOnly: true })
      try {
        expect(manualDb.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
        const installations = manualDb.prepare('SELECT installation_id FROM extension_installations').all() as Array<{ installation_id: string }>
        expect(installations.map(row => row.installation_id)).toContain(expectedInstallationId)
        const cards = manualDb.prepare('SELECT content_json FROM documents WHERE type = ? AND tombstoned = 0').all(applicationDocumentTypes.cardSource) as Array<{ content_json: string }>
        expect(cards.map(row => JSON.parse(row.content_json).name).sort()).toEqual(['Post-migration Card', 'Pre-migration Card'])
      } finally {
        manualDb.close()
      }

      const concurrent = await Promise.all(
        Array.from({ length: 5 }, () => callRpc<{ filename: string; path: string; sizeBytes: number }>(
          migratedAddress.port,
          'dashboard.createBackup',
          {},
        )),
      )
      expect(new Set(concurrent.map(item => item.filename)).size).toBe(5)
      expect(new Set(concurrent.map(item => item.path)).size).toBe(5)
      for (const item of concurrent) {
        expect(item.filename).toMatch(/^studio-backup-.*\.sqlite$/)
        expect(item.path).toBe(join(backupsDir, item.filename))
        expect(item.sizeBytes).toBeGreaterThan(0)
        expect((await stat(item.path)).size).toBe(item.sizeBytes)
        const db = new DatabaseSync(item.path, { readOnly: true })
        try {
          expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
        } finally {
          db.close()
        }
      }
    } finally {
      await migrated?.close().catch(() => {})
      await initial.close().catch(() => {})
      await rm(root, { recursive: true, force: true })
    }
  })

  it('co-locates backups alongside sqlitePath when localPaths is omitted', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'loom-sqlite-path-backup-')))
    const sqlitePath = join(root, 'custom.sqlite')
    const server = createStudioServer({
      sqlitePath,
      secretBackend: createMemorySecretBackend(),
      extensionRootDirectory: join(root, 'empty-repository'),
      extensionInstalledDirectory: join(root, 'app/extensions'),
    })

    try {
      const address = await server.listen(0)
      expect(existsSync(join(root, 'loom.lock'))).toBe(true)

      await callRpc(address.port, 'application.createCard', { name: 'SqlitePath Backup Card' })
      const backup = await callRpc<{ filename: string; path: string; sizeBytes: number }>(
        address.port,
        'dashboard.createBackup',
        {},
      )
      expect(backup.filename).toMatch(/^studio-backup-.*\.sqlite$/)
      expect(backup.path).toBe(join(root, 'backups', backup.filename))
      expect(backup.sizeBytes).toBeGreaterThan(0)
      const db = new DatabaseSync(backup.path, { readOnly: true })
      try {
        expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
      } finally {
        db.close()
      }
    } finally {
      await server.close().catch(() => {})
      await rm(root, { recursive: true, force: true })
    }
  })
})
