import { parseExtensionManifest, type ExtensionManifest } from '@loom-studio/extension-host'
import { randomUUID } from 'node:crypto'
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

const maxPackageFiles = 10_000
const maxPackageBytes = 256 * 1024 * 1024

export type InstalledExtensionPackage = {
  manifest: ExtensionManifest
  directory: string
}

export async function installExtensionPackageFromDirectory(options: {
  sourceDirectory: string
  installedDirectory: string
}): Promise<InstalledExtensionPackage> {
  const sourceDirectory = resolve(options.sourceDirectory)
  const sourceStat = await lstat(sourceDirectory)
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    throw new Error('Extension Package source must be a real directory')
  }

  const manifestBytes = await readFile(join(sourceDirectory, 'manifest.json'))
  const manifest = parseExtensionManifest(JSON.parse(manifestBytes.toString('utf8')) as unknown)
  assertSafePathToken(manifest.id, 'Package id')
  assertSafePathToken(manifest.version, 'Package version')

  await mkdir(resolve(options.installedDirectory), { recursive: true, mode: 0o700 })
  const installedRoot = await realpath(resolve(options.installedDirectory))
  const packageRoot = await ensureChildDirectory(installedRoot, manifest.id)
  const targetDirectory = join(packageRoot, manifest.version)
  const stagingRoot = await ensureChildDirectory(installedRoot, '.staging')
  const stagingDirectory = join(stagingRoot, `${manifest.id}-${manifest.version}-${randomUUID()}`)
  await assertMissing(targetDirectory, `Extension Package is already installed: ${manifest.id}@${manifest.version}`)
  await mkdir(stagingDirectory, { recursive: true, mode: 0o700 })

  try {
    const budget = { files: 0, bytes: 0 }
    await copyPackageDirectory(sourceDirectory, stagingDirectory, budget)
    await writeFile(join(stagingDirectory, 'manifest.json'), manifestBytes, { mode: 0o600 })
    await validateInstalledPackage(stagingDirectory, manifest)
    await rename(stagingDirectory, targetDirectory)
    return { manifest, directory: targetDirectory }
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

async function ensureChildDirectory(parent: string, name: string): Promise<string> {
  const directory = join(parent, name)
  try {
    const stat = await lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Extension install directory must not be a symbolic link: ${directory}`)
    }
  } catch (error) {
    if (!isNodeError(error, 'ENOENT')) throw error
    await mkdir(directory, { recursive: false, mode: 0o700 })
  }
  const resolved = await realpath(directory)
  if (dirname(resolved) !== parent) throw new Error(`Extension install directory escaped its parent: ${directory}`)
  return resolved
}

export async function uninstallExtensionPackageDirectory(options: {
  directory: string
  installedDirectory: string
}): Promise<void> {
  const installedRoot = await realpath(resolve(options.installedDirectory))
  const directory = await realpath(resolve(options.directory))
  const pathFromInstalledRoot = relative(installedRoot, directory)
  const relativeParts = pathFromInstalledRoot.split(/[\\/]/)
  if (pathFromInstalledRoot.startsWith('..') || isAbsolute(pathFromInstalledRoot) || relativeParts.length !== 2 || relativeParts.some(part => !part || part === '.staging')) {
    throw new Error('Only a versioned installed Extension Package may be removed')
  }
  await rm(directory, { recursive: true, force: false })
  await rmdir(dirname(directory)).catch(error => {
    if (!isNodeError(error, 'ENOTEMPTY') && !isNodeError(error, 'EEXIST')) throw error
  })
}

async function copyPackageDirectory(
  sourceDirectory: string,
  targetDirectory: string,
  budget: { files: number; bytes: number },
): Promise<void> {
  const entries = await readdir(sourceDirectory, { withFileTypes: true })
  for (const entry of entries) {
    const source = join(sourceDirectory, entry.name)
    const target = join(targetDirectory, entry.name)
    const stat = await lstat(source)
    if (stat.isSymbolicLink()) throw new Error(`Extension Package cannot contain symbolic links: ${entry.name}`)
    if (stat.isDirectory()) {
      await mkdir(target, { recursive: false, mode: 0o700 })
      await copyPackageDirectory(source, target, budget)
      continue
    }
    if (!stat.isFile()) throw new Error(`Extension Package contains an unsupported file type: ${entry.name}`)

    budget.files += 1
    budget.bytes += stat.size
    // ponytail: 首版本地安装限制单包 10000 文件 / 256 MiB；真实大型 Package 需求出现后改为可配置策略。
    if (budget.files > maxPackageFiles || budget.bytes > maxPackageBytes) {
      throw new Error('Extension Package exceeds the local install size limit')
    }
    await copyFile(source, target)
  }
}

async function validateInstalledPackage(directory: string, expected: ExtensionManifest): Promise<void> {
  const copied = parseExtensionManifest(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as unknown)
  if (copied.id !== expected.id || copied.version !== expected.version) {
    throw new Error('Extension Package manifest changed during installation')
  }
  for (const entry of [
    ...(copied.modules ?? []).map(moduleManifest => moduleManifest.entry),
    ...(copied.contributes?.transformRules ?? []).map(rule => rule.source),
    ...(copied.icon ? [copied.icon] : []),
  ]) {
    const candidate = resolve(directory, entry)
    const pathFromPackage = relative(resolve(directory), candidate)
    if (!pathFromPackage || pathFromPackage.startsWith('..') || isAbsolute(pathFromPackage)) {
      throw new Error(`Extension Package path escapes its root: ${entry}`)
    }
    const stat = await lstat(candidate)
    if (!stat.isFile()) throw new Error(`Extension Package entry must be a file: ${entry}`)
  }
}

async function assertMissing(path: string, message: string): Promise<void> {
  try {
    await lstat(path)
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return
    throw error
  }
  throw new Error(message)
}

function assertSafePathToken(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(value) || basename(value) !== value) {
    throw new Error(`${label} is not safe for an install path: ${value}`)
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
