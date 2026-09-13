import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { cp, lstat, mkdir, mkdtemp, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'

type FileDigest = { path: string; bytes: number; sha256: string }

export async function inspectDataMigration(sourceInput: string, targetInput: string) {
  const source = resolve(sourceInput)
  const target = resolve(targetInput)
  if (isWithin(source, target) || isWithin(target, source)) throw new Error('Source and target directories must not overlap')
  if (!(await lstat(source)).isDirectory() || await realpath(source) !== source) {
    throw new Error('Source must be a real directory without symlink ancestors')
  }
  const targetExists = await exists(target)
  const database = await lstat(join(source, 'studio.sqlite'))
  if (!database.isFile() || database.size === 0) throw new Error('Source must contain a nonempty studio.sqlite')
  return { source, target, targetExists, databaseBytes: database.size }
}

export async function migrateDataDirectory(sourceInput: string, targetInput: string) {
  const input = await inspectDataMigration(sourceInput, targetInput)
  if (input.targetExists) throw new Error('Target already exists; migration never merges or overwrites it')
  const parent = dirname(input.target)
  if (await realpath(parent) !== parent) throw new Error('Target parent must exist without symlink ancestors')
  assertOffline(input.source)
  const before = await inventory(input.source)
  const staged = await mkdtemp(`${input.target}.migrating-`)
  try {
    await cp(input.source, staged, { recursive: true, errorOnExist: false, force: false })
    assertSame(before, await inventory(staged), 'Copied bytes do not match source')
    const database = new DatabaseSync(join(staged, 'studio.sqlite'), { readOnly: true })
    try {
      const result = database.prepare('PRAGMA integrity_check').all()
      if (result.length !== 1 || Object.values(result[0]!)[0] !== 'ok') throw new Error('Copied SQLite integrity check failed')
    } finally {
      database.close()
    }
    assertOffline(input.source)
    assertSame(before, await inventory(input.source), 'Source changed during migration; stop all writers and retry')
    if (await exists(input.target)) throw new Error('Target appeared during migration; refusing to replace it')
    const receipt = {
      version: 1,
      source: input.source,
      target: input.target,
      createdAt: new Date().toISOString(),
      files: before.length,
      bytes: before.reduce((sum, file) => sum + file.bytes, 0),
      sourceDigest: createHash('sha256').update(JSON.stringify(before)).digest('hex'),
    }
    await mkdir(join(staged, '.loom'), { recursive: true })
    await writeFile(join(staged, '.loom/data-migration.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    await rename(staged, input.target)
    return receipt
  } catch (error) {
    await rm(staged, { recursive: true, force: true })
    throw error
  }
}

function assertOffline(source: string) {
  const result = spawnSync('lsof', ['-t', '+D', source], { encoding: 'utf8' })
  if (result.error || result.stderr.trim() || (result.status !== 0 && result.status !== 1)) {
    throw new Error(`Cannot verify offline source using lsof; migration refused. ${result.error?.message ?? result.stderr.trim()}`)
  }
  if (result.status === 0 || result.stdout.trim()) throw new Error('Source files are open; stop LS and all source-directory readers before migration')
}

async function inventory(root: string): Promise<FileDigest[]> {
  const files: FileDigest[] = []
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) {
        const hash = createHash('sha256')
        let bytes = 0
        for await (const chunk of createReadStream(path)) {
          hash.update(chunk)
          bytes += chunk.length
        }
        files.push({ path: relative(root, path), bytes, sha256: hash.digest('hex') })
      } else throw new Error(`Unsupported source entry (links are not copied): ${relative(root, path)}`)
    }
  }
  await visit(root)
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

function assertSame(left: FileDigest[], right: FileDigest[], message: string) {
  if (JSON.stringify(left) !== JSON.stringify(right)) throw new Error(message)
}

function isWithin(parent: string, child: string) {
  const path = relative(parent, child)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

async function exists(path: string) {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}
