import { projectPromptResourceFiles } from '../../../apps/studio-server/src/codecs/prompt-resource-files.js'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import {
  installExtensionPackageFromDirectory,
  installExtensionPackageFromZip,
  uninstallExtensionPackageDirectory,
} from '../../../apps/studio-server/src/extensions/extension-package-installer.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('local Extension Package installer', () => {
  it.each(['..icon.png', '../outside.png', '/outside.png'])('validates icon paths from a ZIP: %s', async icon => {
    const root = await temporaryRoot()
    const archive = zipSync({
      'manifest.json': new TextEncoder().encode(JSON.stringify({
        manifestVersion: 2, id: 'example.icon', version: '1.0.0', displayName: 'Icon', engines: { studio: '^0.1.0' }, icon,
      })),
      '..icon.png': new Uint8Array([137, 80, 78, 71]),
    })
    const installation = installExtensionPackageFromZip({ source: archive, installedDirectory: join(root, 'installed') })
    if (icon === '..icon.png') {
      const installed = await installation
      expect(await readFile(join(installed.directory, icon))).toEqual(Buffer.from([137, 80, 78, 71]))
    } else await expect(installation).rejects.toThrow()
  })

  it.each(['valid', 'missing', 'escape', 'symlink'])('validates indexed Prompt Resource files: %s', async mode => {
    const root = await temporaryRoot()
    const source = await writePackage(root, 'source', 'example.prompt-files', '1.0.0')
    const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'))
    manifest.contributes = { promptResources: [{ id: 'preset', resourceKind: 'prompt', source: './preset/index.json' }] }
    await writeFile(join(source, 'manifest.json'), JSON.stringify(manifest))
    const files: Record<string, Uint8Array> = {}
    const index = projectPromptResourceFiles({ format: 'loom.promptResource', schemaVersion: 2, resourceKind: 'prompt',
      rootNode: { id: 'root', kind: 'module', label: 'Preset', body: 'Markdown body' } }, files)
    await mkdir(join(source, 'preset/entries'), { recursive: true })
    if (mode === 'escape') index.rootNode.body = '../../outside.md'
    if (mode === 'valid') await writeFile(join(source, 'preset/entries/0.md'), files['entries/0.md']!)
    if (mode === 'symlink') {
      await writeFile(join(root, 'outside.md'), 'outside')
      await symlink(join(root, 'outside.md'), join(source, 'preset/entries/0.md'))
    }
    await writeFile(join(source, 'preset/index.json'), JSON.stringify(index))
    const installation = installExtensionPackageFromDirectory({ sourceDirectory: source, installedDirectory: join(root, 'installed') })
    if (mode === 'valid') {
      const installed = await installation
      expect(await readFile(join(installed.directory, 'preset/entries/0.md'), 'utf8')).toBe('Markdown body')
    } else await expect(installation).rejects.toThrow()
  })

  it('rejects a static background package whose declared image is missing before installation', async () => {
    const root = await temporaryRoot()
    const source = await writePackage(root, 'source', 'example.backgrounds', '1.0.0')
    const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'))
    manifest.contributes = { backgrounds: [{ id: 'scene', name: 'Scene', description: 'Scene', image: './missing.png' }] }
    await writeFile(join(source, 'manifest.json'), JSON.stringify(manifest))
    await expect(installExtensionPackageFromDirectory({ sourceDirectory: source, installedDirectory: join(root, 'installed') })).rejects.toThrow('missing.png')
    expect(await readdir(join(root, 'installed/example.backgrounds'))).toEqual([])
  })

  it('installs a validated Package atomically by id and version', async () => {
    const root = await temporaryRoot()
    const source = await writePackage(root, 'source', 'example.install', '1.2.3')
    const installedRoot = join(root, 'installed')

    const installed = await installExtensionPackageFromDirectory({ sourceDirectory: source, installedDirectory: installedRoot })

    expect(installed.directory).toBe(await realpath(join(installedRoot, 'example.install', '1.2.3')))
    await expect(readFile(join(installed.directory, 'dist/index.js'), 'utf8')).resolves.toContain('activate')
    await expect(installExtensionPackageFromDirectory({ sourceDirectory: source, installedDirectory: installedRoot })).rejects.toThrow('already installed')
  })

  it('rejects symlinks and cleans the failed staging directory', async () => {
    const root = await temporaryRoot()
    const source = await writePackage(root, 'source', 'example.symlink', '1.0.0')
    await writeFile(join(root, 'outside.txt'), 'outside')
    await symlink(join(root, 'outside.txt'), join(source, 'linked.txt'))
    const installedRoot = join(root, 'installed')

    await expect(installExtensionPackageFromDirectory({ sourceDirectory: source, installedDirectory: installedRoot })).rejects.toThrow('symbolic links')
    await expect(readdir(join(installedRoot, '.staging'))).resolves.toEqual([])
    await expect(readFile(join(installedRoot, 'example.symlink', '1.0.0', 'manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects manifest entries that escape the Package root', async () => {
    const root = await temporaryRoot()
    const source = await writePackage(root, 'source', 'example.escapeInstall', '1.0.0', '../outside.js')
    await writeFile(join(root, 'outside.js'), 'export function activate() {}')

    await expect(installExtensionPackageFromDirectory({
      sourceDirectory: source,
      installedDirectory: join(root, 'installed'),
    })).rejects.toThrow('escapes its root')
  })

  it('explains missing release entries without exposing the staging path', async () => {
    const root = await temporaryRoot()
    const source = await writePackage(root, 'source', 'example.missing-dist', '1.0.0')
    await rm(join(source, 'dist'), { recursive: true })
    const installedRoot = join(root, 'installed')

    await expect(installExtensionPackageFromDirectory({
      sourceDirectory: source,
      installedDirectory: installedRoot,
    })).rejects.toThrow('扩展 example.missing-dist 的发行包缺少 Manifest 声明的文件：./dist/index.js')
    await expect(readdir(join(installedRoot, '.staging'))).resolves.toEqual([])
  })

  it('only uninstalls a versioned directory under the installed root', async () => {
    const root = await temporaryRoot()
    const source = await writePackage(root, 'source', 'example.remove', '1.0.0')
    const installedRoot = join(root, 'installed')
    const installed = await installExtensionPackageFromDirectory({ sourceDirectory: source, installedDirectory: installedRoot })

    await expect(uninstallExtensionPackageDirectory({ directory: source, installedDirectory: installedRoot })).rejects.toThrow('Only a versioned installed')
    await uninstallExtensionPackageDirectory({ directory: installed.directory, installedDirectory: installedRoot })
    await expect(readFile(join(installed.directory, 'manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('installs a nested ZIP package through the same validated directory path', async () => {
    const root = await temporaryRoot()
    const source = await writePackage(root, 'source', 'example.zip', '1.0.0')
    const archive = zipSync({
      'manifest.json': await readFile(join(source, 'manifest.json')),
      'dist/index.js': await readFile(join(source, 'dist/index.js')),
      'assets/icon.txt': new TextEncoder().encode('icon'),
    })

    const installed = await installExtensionPackageFromZip({
      source: archive,
      installedDirectory: join(root, 'installed'),
    })

    await expect(readFile(join(installed.directory, 'assets/icon.txt'), 'utf8')).resolves.toBe('icon')
  })

  it('installs a GitHub archive with a single wrapper directory regardless of entry order', async () => {
    const root = await temporaryRoot()
    const source = await writePackage(root, 'source', 'example.github-zip', '1.0.0')
    const installed = await installExtensionPackageFromZip({
      source: zipSync({
        'repo-main/dist/index.js': await readFile(join(source, 'dist/index.js')),
        'repo-main/': new Uint8Array(),
        'repo-main/dist/': new Uint8Array(),
        'repo-main/manifest.json': await readFile(join(source, 'manifest.json')),
      }),
      installedDirectory: join(root, 'installed'),
    })
    await expect(readFile(join(installed.directory, 'dist/index.js'), 'utf8')).resolves.toContain('activate')
    await expect(readdir(installed.directory)).resolves.toEqual(['dist', 'manifest.json'])
  })

  it('rejects ambiguous or deeply nested package roots with an actionable error', async () => {
    const root = await temporaryRoot()
    for (const files of [
      { 'one/manifest.json': new Uint8Array(), 'two/manifest.json': new Uint8Array() },
      { 'one/two/manifest.json': new Uint8Array() },
    ]) {
      await expect(installExtensionPackageFromZip({
        source: zipSync(files),
        installedDirectory: join(root, 'installed'),
      })).rejects.toThrow('唯一的第一层目录')
    }
  })

  it('rejects ZIP paths that escape the temporary package root', async () => {
    const root = await temporaryRoot()
    const manifest = JSON.stringify({
      manifestVersion: 2,
      id: 'example.zip-escape',
      version: '1.0.0',
      displayName: 'example.zip-escape',
      engines: { studio: '^0.1.0' },
      modules: [{ id: 'server', runtime: 'server', entry: './dist/index.js' }],
    })

    await expect(installExtensionPackageFromZip({
      source: zipSync({
        'manifest.json': new TextEncoder().encode(manifest),
        '../outside.js': new TextEncoder().encode('nope'),
      }),
      installedDirectory: join(root, 'installed'),
    })).rejects.toThrow('escapes its root')
  })

  it('rejects an oversized ZIP before attempting to unpack it', async () => {
    const root = await temporaryRoot()
    await expect(installExtensionPackageFromZip({
      source: new Uint8Array(256 * 1024 * 1024 + 1),
      installedDirectory: join(root, 'installed'),
    })).rejects.toThrow('exceeds the local install size limit')
  })

  it('rejects platform-specific backslash paths in ZIP entries', async () => {
    const root = await temporaryRoot()
    await expect(installExtensionPackageFromZip({
      source: zipSync({
        'manifest.json': new TextEncoder().encode('{}'),
        '..\\outside.js': new TextEncoder().encode('nope'),
      }),
      installedDirectory: join(root, 'installed'),
    })).rejects.toThrow('unsafe path')
  })
})

async function temporaryRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'loom-extension-install-'))
  temporaryDirectories.push(directory)
  return directory
}

async function writePackage(
  root: string,
  name: string,
  id: string,
  version: string,
  entry = './dist/index.js',
): Promise<string> {
  const directory = join(root, name)
  await mkdir(join(directory, 'dist'), { recursive: true })
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({
    manifestVersion: 2,
    id,
    version,
    displayName: id,
    engines: { studio: '^0.1.0' },
    modules: [{ id: 'server', runtime: 'server', entry }],
  }))
  await writeFile(join(directory, 'dist/index.js'), 'export function activate() {}\n')
  return directory
}
