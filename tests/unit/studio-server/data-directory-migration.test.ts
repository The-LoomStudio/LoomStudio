import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { spawnSync } from 'node:child_process'
import { inspectDataMigration, migrateDataDirectory } from '../../../scripts/lib/data-directory-migration.js'
import { assertDevelopmentDataReady, developmentDataEnvironment } from '../../../scripts/development-data-paths.mjs'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'loom-data-migration-')))
  roots.push(root)
  const source = join(root, '.loomstudio-dev/data')
  const target = join(root, 'data')
  await mkdir(source, { recursive: true })
  const db = new DatabaseSync(join(source, 'studio.sqlite'))
  db.exec("CREATE TABLE cards (id TEXT PRIMARY KEY, name TEXT); INSERT INTO cards VALUES ('card-1', 'Saved Card')")
  db.close()
  await mkdir(join(source, 'blobs'), { recursive: true })
  await writeFile(join(source, 'blobs/picture'), Buffer.from([0, 1, 255, 42]))
  await mkdir(join(source, 'extensions'))
  await writeFile(join(source, 'extensions/state.json'), '{"version":3,"packages":{}}')
  return { root, source, target }
}

describe('development data layout', () => {
  it('defaults only persistent data to repository/data and preserves overrides', () => {
    expect(developmentDataEnvironment('/repo', {})).toMatchObject({
      LOOM_STUDIO_HOME: '/repo/.loomstudio-dev',
      LOOM_STUDIO_DATA_ROOT: '/repo/data',
    })
    expect(developmentDataEnvironment('/repo', { LOOM_STUDIO_HOME: '/custom' }).LOOM_STUDIO_DATA_ROOT).toBe('/custom/data')
    expect(developmentDataEnvironment('/repo', { LOOM_STUDIO_DATA_ROOT: '/other' }).LOOM_STUDIO_DATA_ROOT).toBe('/other')
  })

  it('does not create a target in inspection mode or silently start a blank database', async () => {
    const { root, source, target } = await fixture()
    expect(await inspectDataMigration(source, target)).toMatchObject({ targetExists: false })
    expect(await readdir(root)).toEqual(['.loomstudio-dev'])
    expect(() => assertDevelopmentDataReady(root, {})).toThrow('offline migration')
    expect(() => assertDevelopmentDataReady(root, { LOOM_STUDIO_HOME: join(root, '.loomstudio-dev') })).not.toThrow()
  })
})

describe('offline data directory migration', () => {
  it('preserves committed WAL data left by an interrupted process', async () => {
    const { source, target } = await fixture()
    const filename = join(source, 'studio.sqlite')
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { DatabaseSync } from 'node:sqlite'
      const db = new DatabaseSync(process.argv[1])
      db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; INSERT INTO cards VALUES ('wal-card', 'Committed in WAL')")
      process.kill(process.pid, 'SIGKILL')
    `, filename], { encoding: 'utf8' })
    expect(child.signal).toBe('SIGKILL')
    const sourceWal = await readFile(`${filename}-wal`)
    expect(sourceWal.length).toBeGreaterThan(0)
    await migrateDataDirectory(source, target)
    const copy = new DatabaseSync(join(target, 'studio.sqlite'), { readOnly: true })
    try {
      expect(copy.prepare("SELECT name FROM cards WHERE id='wal-card'").get()).toMatchObject({ name: 'Committed in WAL' })
    } finally {
      copy.close()
    }
    expect(await readFile(`${filename}-wal`)).toEqual(sourceWal)
  })

  it('copies DB, binary and extension state and reopens with original identities', async () => {
    const { root, source, target } = await fixture()
    const before = await readFile(join(source, 'studio.sqlite'))
    const receipt = await migrateDataDirectory(source, target)
    expect(receipt.files).toBe(3)
    const copy = new DatabaseSync(join(target, 'studio.sqlite'), { readOnly: true })
    try {
      expect(copy.prepare('SELECT * FROM cards').get()).toMatchObject({ id: 'card-1', name: 'Saved Card' })
    } finally {
      copy.close()
    }
    expect(await readFile(join(target, 'blobs/picture'))).toEqual(await readFile(join(source, 'blobs/picture')))
    expect(await readFile(join(target, 'extensions/state.json'))).toEqual(await readFile(join(source, 'extensions/state.json')))
    expect(await readFile(join(source, 'studio.sqlite'))).toEqual(before)
    expect(() => assertDevelopmentDataReady(root, {})).not.toThrow()
    await expect(migrateDataDirectory(source, target)).rejects.toThrow('already exists')
  })

  it('rejects existing/overlapping targets without merging or deleting them', async () => {
    const { source, target } = await fixture()
    await mkdir(target)
    await writeFile(join(target, 'keep'), 'user data')
    await expect(migrateDataDirectory(source, target)).rejects.toThrow('already exists')
    await expect(migrateDataDirectory(source, join(source, 'child'))).rejects.toThrow('overlap')
    expect(await readFile(join(target, 'keep'), 'utf8')).toBe('user data')
  })

  it('rejects open source files', async () => {
    const { source, target } = await fixture()
    const active = new DatabaseSync(join(source, 'studio.sqlite'))
    try {
      await expect(migrateDataDirectory(source, target)).rejects.toThrow('Source files are open')
    } finally {
      active.close()
    }
  })

  it('does not publish a corrupt database and cleans only its staging directory', async () => {
    const { root, source, target } = await fixture()
    await writeFile(join(source, 'studio.sqlite'), 'not a database')
    await expect(migrateDataDirectory(source, target)).rejects.toThrow()
    expect(await readdir(root)).toEqual(['.loomstudio-dev'])
    expect(await readFile(join(source, 'studio.sqlite'), 'utf8')).toBe('not a database')
  })

  it('rejects symlink payloads instead of copying external files', async () => {
    const { root, source, target } = await fixture()
    await writeFile(join(root, 'private'), 'do not copy')
    await symlink(join(root, 'private'), join(source, 'link'))
    await expect(migrateDataDirectory(source, target)).rejects.toThrow('links are not copied')
    expect(await readFile(join(root, 'private'), 'utf8')).toBe('do not copy')
  })
})
