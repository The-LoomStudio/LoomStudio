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
