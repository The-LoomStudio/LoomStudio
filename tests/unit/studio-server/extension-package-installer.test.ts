import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  installExtensionPackageFromDirectory,
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
