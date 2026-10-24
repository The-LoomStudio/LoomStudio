import { loadPromptResourceFiles } from '../codecs/prompt-resource-files.js'
import { parseExtensionManifest, type ExtensionManifest } from '@loom-studio/extension-host'
import { unzipSync, zipSync } from 'fflate'
import { randomUUID } from 'node:crypto'
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'

const maxPackageFiles = 10_000
export const maxPackageBytes = 256 * 1024 * 1024

export type InstalledExtensionPackage = {
  manifest: ExtensionManifest
  directory: string
}

export async function installExtensionPackageFromDirectory(options: {
  sourceDirectory: string
  installedDirectory: string
  flat?: boolean
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
  const targetDirectory = options.flat
    ? join(installedRoot, manifest.id)
    : join(await ensureChildDirectory(installedRoot, manifest.id), manifest.version)
  const stagingRoot = await ensureChildDirectory(installedRoot, '.staging')
  const stagingDirectory = join(stagingRoot, `${manifest.id}-${manifest.version}-${randomUUID()}`)
  await assertMissing(targetDirectory, `Extension Package is already installed: ${manifest.id}@${manifest.version}`)
  await mkdir(stagingDirectory, { recursive: true, mode: 0o700 })

  try {
    const budget = { files: 0, bytes: 0 }
    await visitPackageFiles(sourceDirectory, budget, async (source, path, directory) => {
      const target = join(stagingDirectory, path)
      if (directory) {
        await mkdir(target, { recursive: true, mode: 0o700 })
        return
      }
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      await copyFile(source, target)
    })
    await writeFile(join(stagingDirectory, 'manifest.json'), manifestBytes, { mode: 0o600 })
    await validateInstalledPackage(stagingDirectory, manifest)
    await rename(stagingDirectory, targetDirectory)
    return { manifest, directory: targetDirectory }
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

export async function installExtensionPackageFromZip(options: {
  source: Uint8Array
  installedDirectory: string
  flat?: boolean
}): Promise<InstalledExtensionPackage> {
  const files = readExtensionPackageZip(options.source)
  const stagingDirectory = await mkdtemp(join(tmpdir(), 'loom-extension-'))
  try {
    for (const [entryName, bytes] of Object.entries(files)) {
      const path = safeZipEntryPath(stagingDirectory, entryName)
      if (entryName.endsWith('/')) {
        await mkdir(path, { recursive: true, mode: 0o700 })
        continue
      }
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      await writeFile(path, bytes, { mode: 0o600 })
    }
    return await installExtensionPackageFromDirectory({
      sourceDirectory: await resolveZipPackageDirectory(stagingDirectory),
      installedDirectory: options.installedDirectory,
      flat: options.flat,
    })
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined)
  }
}

export function readExtensionPackageZip(source: Uint8Array): Record<string, Uint8Array> {
  if (source.byteLength > maxPackageBytes) {
    throw new Error('Extension Package exceeds the local install size limit')
  }
  const seenEntries = new Set<string>()
  let declaredFiles = 0
  let declaredBytes = 0
  const files = unzipSync(source, {
    filter: entry => {
      safeZipEntryPath('/loom-extension-archive', entry.name)
      if (seenEntries.has(entry.name)) throw new Error(`Extension Package ZIP contains a duplicate path: ${entry.name}`)
      seenEntries.add(entry.name)
      declaredFiles += 1
      declaredBytes += entry.originalSize ?? 0
      if (declaredFiles > maxPackageFiles || declaredBytes > maxPackageBytes) {
        throw new Error('Extension Package exceeds the local install size limit')
      }
      return true
    },
  })
  const budget = { files: 0, bytes: 0 }
  for (const [entryName, bytes] of Object.entries(files)) {
    if (entryName.endsWith('/')) continue
    budget.files += 1
    budget.bytes += bytes.byteLength
    if (budget.files > maxPackageFiles || budget.bytes > maxPackageBytes) {
      throw new Error('Extension Package exceeds the local install size limit')
    }
  }
  return files
}

async function resolveZipPackageDirectory(root: string): Promise<string> {
  const entries = await readdir(root, { withFileTypes: true })
  if (entries.some(entry => entry.name === 'manifest.json' && entry.isFile())) return root
  if (entries.length === 1 && entries[0]!.isDirectory()) {
    const directory = join(root, entries[0]!.name)
    const children = await readdir(directory, { withFileTypes: true })
    if (children.some(entry => entry.name === 'manifest.json' && entry.isFile())) return directory
  }
  throw new Error('扩展 ZIP 必须在根目录或唯一的第一层目录中包含 manifest.json。请选择扩展发行包。')
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
  flat?: boolean
}): Promise<void> {
  const installedRoot = await realpath(resolve(options.installedDirectory))
  const directory = await realpath(resolve(options.directory))
  const pathFromInstalledRoot = relative(installedRoot, directory)
  const relativeParts = pathFromInstalledRoot.split(/[\\/]/)
  if (pathFromInstalledRoot.startsWith('..') || isAbsolute(pathFromInstalledRoot) || relativeParts.length !== (options.flat ? 1 : 2) || relativeParts.some(part => !part || part.startsWith('.'))) {
    throw new Error('Only a versioned installed Extension Package may be removed')
  }
  await rm(directory, { recursive: true, force: false })
  if (options.flat) return
  await rmdir(dirname(directory)).catch(error => {
    if (!isNodeError(error, 'ENOTEMPTY') && !isNodeError(error, 'EEXIST')) throw error
  })
}

export async function exportExtensionPackageZip(directory: string, expected: ExtensionManifest): Promise<Uint8Array> {
  const root = await lstat(directory)
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('Extension Package source must be a real directory')
  const files: Record<string, Uint8Array> = Object.create(null)
  let bytes = 0
  let entries = 0
  await visitPackageFiles(directory, { files: 0, bytes: 0 }, async (source, path, isDirectory) => {
    if (++entries > maxPackageFiles) throw new Error('Extension Package exceeds the local install size limit')
    if (isDirectory) {
      files[`${path}/`] = new Uint8Array()
      return
    }
    const content = await readFile(source)
    bytes += content.byteLength
    if (bytes > maxPackageBytes) throw new Error('Extension Package exceeds the local install size limit')
    files[path] = content
  })
  const manifestBytes = files['manifest.json']
  if (!manifestBytes) throw new Error('Extension Package is missing manifest.json')
  const manifest = parseExtensionManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)))
  if (manifest.id !== expected.id || manifest.version !== expected.version) throw new Error('Extension Package changed before export')
  for (const entry of [
    ...(manifest.modules ?? []).map(module => module.entry),
    ...(manifest.contributes?.backgrounds ?? []).map(background => background.image),
    ...(manifest.contributes?.promptResources ?? []).map(resource => resource.source),
    ...(manifest.contributes?.agentTools ?? []).map(tool => tool.source),
    ...(manifest.contributes?.transformRules ?? []).map(rule => rule.source),
    ...(manifest.contributes?.textExtractors ?? []).map(extractor => extractor.source),
    ...(manifest.icon ? [manifest.icon] : []),
  ]) {
    if (!files[entry.replace(/^\.\//, '')]) throw new Error(`Extension Package entry is missing: ${entry}`)
  }
  for (const resource of manifest.contributes?.promptResources ?? []) {
    const source = resource.source.replace(/^\.\//, '')
    await loadPromptResourceFiles(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files[source])), async path => {
      const entry = posix.join(posix.dirname(source), path)
      const bytes = files[entry]
      if (!bytes) throw new Error(`Extension Package entry is missing: ${entry}`)
      return bytes
    })
  }
  return zipSync(files)
}

async function visitPackageFiles(
  sourceDirectory: string,
  budget: { files: number; bytes: number },
  visit: (source: string, path: string, directory: boolean) => Promise<void>,
  prefix = '',
): Promise<void> {
  const entries = await readdir(sourceDirectory, { withFileTypes: true })
  for (const entry of entries) {
    if (!prefix && ['.git', 'node_modules', '.loom-source.json', '.loom-zip-install'].includes(entry.name)) continue
    const source = join(sourceDirectory, entry.name)
    const path = `${prefix}${entry.name}`
    assertSafeZipEntryName(path)
    const stat = await lstat(source)
    if (stat.isSymbolicLink()) throw new Error(`Extension Package cannot contain symbolic links: ${entry.name}`)
    if (stat.isDirectory()) {
      await visit(source, path, true)
      await visitPackageFiles(source, budget, visit, `${path}/`)
      continue
    }
    if (!stat.isFile()) throw new Error(`Extension Package contains an unsupported file type: ${entry.name}`)

    budget.files += 1
    budget.bytes += stat.size
    // ponytail: 首版本地安装限制单包 10000 文件 / 256 MiB；真实大型 Package 需求出现后改为可配置策略。
    if (budget.files > maxPackageFiles || budget.bytes > maxPackageBytes) {
      throw new Error('Extension Package exceeds the local install size limit')
    }
    await visit(source, path, false)
  }
}

async function validateInstalledPackage(directory: string, expected: ExtensionManifest): Promise<void> {
  const copied = parseExtensionManifest(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as unknown)
  if (copied.id !== expected.id || copied.version !== expected.version) {
    throw new Error('Extension Package manifest changed during installation')
  }
  for (const entry of [
    ...(copied.modules ?? []).map(moduleManifest => moduleManifest.entry),
    ...(copied.contributes?.backgrounds ?? []).map(background => background.image),
    ...(copied.contributes?.transformRules ?? []).map(rule => rule.source),
    ...(copied.contributes?.textExtractors ?? []).map(extractor => extractor.source),
    ...(copied.contributes?.promptResources ?? []).map(resource => resource.source),
    ...(copied.contributes?.agentTools ?? []).map(tool => tool.source),
    ...(copied.contributes?.loomScripts ?? []).map(script => script.source),
    ...(copied.icon ? [copied.icon] : []),
  ]) {
    const candidate = resolve(directory, entry)
    const pathFromPackage = relative(resolve(directory), candidate)
    if (!pathFromPackage || pathFromPackage === '..' || pathFromPackage.startsWith(`..${sep}`) || isAbsolute(pathFromPackage)) {
      throw new Error(`Extension Package path escapes its root: ${entry}`)
    }
    const stat = await lstat(candidate).catch((error: unknown) => {
      if (isNodeError(error, 'ENOENT')) {
        throw new Error(`扩展 ${copied.id} 的发行包缺少 Manifest 声明的文件：${entry}。请作者提供包含可运行产物的发行分支或成品 ZIP；宿主不会自动构建。`)
      }
      throw error
    })
    if (!stat.isFile()) throw new Error(`Extension Package entry must be a file: ${entry}`)
  }
  for (const resource of copied.contributes?.promptResources ?? []) {
    const source = resolve(directory, resource.source)
    if ((await lstat(source)).size > 16 * 1024 * 1024) throw new Error('Prompt Resource exceeds maximum size')
    await loadPromptResourceFiles(JSON.parse(await readFile(source, 'utf8')), async path => {
      const candidate = resolve(dirname(source), path)
      const actual = await realpath(candidate)
      const inside = relative(resolve(directory), actual)
      if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error('Extension Package path escapes its root')
      const info = await lstat(actual)
      if (!info.isFile() || info.size > 16 * 1024 * 1024) throw new Error('Invalid Prompt Resource file size or type')
      return readFile(actual)
    })
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

function safeZipEntryPath(root: string, entryName: string): string {
  assertSafeZipEntryName(entryName)
  const candidate = resolve(root, entryName)
  const pathFromRoot = relative(resolve(root), candidate)
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new Error(`Extension Package ZIP path escapes its root: ${entryName}`)
  }
  return candidate
}

function assertSafeZipEntryName(entryName: string): void {
  if (!entryName || entryName.includes('\0') || entryName.includes('\\') || entryName.startsWith('/') || /^[A-Za-z]:[\\/]/.test(entryName)) {
    throw new Error(`Extension Package ZIP contains an unsafe path: ${entryName}`)
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
