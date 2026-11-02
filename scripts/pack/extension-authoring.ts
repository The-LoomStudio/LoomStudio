import { copyFile, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parseExtensionManifest } from '../../packages/extension-sdk/extension-host/src/manifest.js'
import { authoringResourceSchema } from '../../packages/shared/src/resource-authoring-contracts.js'
import { isPromptResourceArtifact } from '../../packages/application-runtime/src/cards/workspace-codec.js'
import { loadResourceAuthoring } from '../../apps/studio-server/src/codecs/resource-authoring.js'
import { encodeCardBundleZip, loadCardBundleFiles } from '../../apps/studio-server/src/codecs/card-bundle-zip.js'
import { exportExtensionPackageZip } from '../../apps/studio-server/src/extensions/extension-package-installer.js'

export type ExtensionAuthoringBuildInput = {
  sourceDirectory: string
  outputDirectory: string
  resources: Array<{ contributionId: string; directory: string }>
  characters?: Array<{ contributionId: string; directory: string }>
}

function inside(root: string, path: string): boolean {
  const value = relative(root, path)
  return !isAbsolute(value) && value !== '..' && !value.startsWith(`..${sep}`)
}
function packagePath(path: string): string {
  const value = path.replace(/^\.\//, '')
  if (!value || isAbsolute(value) || value.includes('\\') || value.includes(':') || value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`Unsafe package path: ${path}`)
  return value
}

/** Build a staging extension; never installs, publishes, or overwrites a source package. */
export async function buildExtensionAuthoring(input: ExtensionAuthoringBuildInput) {
  const source = await realpath(input.sourceDirectory)
  if (!(await lstat(source)).isDirectory()) throw new Error('Extension source must be a directory')
  const requestedOutput = resolve(input.outputDirectory)
  const output = join(await realpath(dirname(requestedOutput)), requestedOutput.slice(dirname(requestedOutput).length + 1))
  if (inside(source, output) || inside(output, source)) throw new Error('Output and source directories must not overlap')
  const manifest = parseExtensionManifest(JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8')))
  const contributions = manifest.contributes?.promptResources ?? []
  const ids = new Set<string>()
  const sources = new Set<string>()
  for (const contribution of contributions) {
    if (ids.has(contribution.id)) throw new Error(`Duplicate contribution ID: ${contribution.id}`)
    ids.add(contribution.id)
    const path = packagePath(contribution.source)
    if (sources.has(path)) throw new Error(`Shared contribution source: ${path}`)
    sources.add(path)
  }
  const mapped = new Set<string>()
  const excluded = new Set<string>()
  const generated = new Map<string, string | Uint8Array>()
  for (const item of input.resources) {
    if (mapped.has(item.contributionId)) throw new Error(`Duplicate authoring mapping: ${item.contributionId}`)
    mapped.add(item.contributionId)
    const contribution = contributions.find(value => value.id === item.contributionId)
    if (!contribution) throw new Error(`Unknown contribution: ${item.contributionId}`)
    const directory = await realpath(resolve(source, item.directory))
    if (directory === source) throw new Error('Authoring directory cannot be the extension root')
    if (inside(source, directory)) excluded.add(directory)
    const resource = authoringResourceSchema.parse(await loadResourceAuthoring(directory))
    if (resource.resourceKind !== contribution.resourceKind) throw new Error(`Resource kind mismatch: ${item.contributionId}`)
    const icon = resource.metadata?.icon
    if (icon && icon.packageId !== manifest.id) {
      if (!icon.scope) throw new Error(`External icon requires an installation scope: ${icon.packageId}`)
      if (!manifest.dependencies?.some(dependency => dependency.id === icon.packageId)) throw new Error(`Icon dependency is not declared: ${icon.packageId}`)
      // Offline builds validate the portable declaration; the Server validates the selected installation and actual file.
      packagePath(icon.path)
    }
    const { id: _id, format: _format, schemaVersion: _schema, loreMounts, toolMounts, ...fields } = resource
    const artifact = { format: 'loom.promptResource', schemaVersion: 2, ...fields }
    if (!isPromptResourceArtifact(artifact)) throw new Error(`Invalid generated Prompt Resource: ${item.contributionId}`)
    generated.set(packagePath(contribution.source), JSON.stringify(artifact, null, 2) + '\n')
    contribution.loreMounts = (loreMounts ?? []).map((reference, orderIndex) => ({ reference, orderIndex }))
    contribution.toolMounts = toolMounts ?? []
    for (const mount of toolMounts ?? []) {
      const reference = mount.reference
      if (reference?.kind === 'package' && !manifest.contributes?.agentTools?.some(tool => tool.id === reference.contributionId)) {
        throw new Error(`Missing package Tool contribution: ${reference.contributionId}`)
      }
      if (reference?.kind === 'external' && !manifest.dependencies?.some(dependency => dependency.id === reference.packageId)) {
        throw new Error(`Tool dependency is not declared: ${reference.packageId}`)
      }
    }
    for (const reference of loreMounts ?? []) {
      if (reference.kind === 'package' && !contributions.some(value => value.id === reference.contributionId && value.resourceKind === 'lore')) throw new Error(`Missing package Lore contribution: ${reference.contributionId}`)
    }
  }
  const characterMappings = new Set<string>()
  for (const item of input.characters ?? []) {
    if (characterMappings.has(item.contributionId)) throw new Error(`Duplicate character mapping: ${item.contributionId}`)
    characterMappings.add(item.contributionId)
    const contribution = manifest.contributes?.characters?.find(value => value.id === item.contributionId)
    if (!contribution) throw new Error(`Unknown character contribution: ${item.contributionId}`)
    const directory = await realpath(resolve(source, item.directory))
    if (directory === source) throw new Error('Character authoring directory cannot be the extension root')
    if (inside(source, directory)) excluded.add(directory)
    const { bundle } = await loadCardBundleFiles(async path => {
      const filename = await realpath(join(directory, packagePath(path)))
      if (!inside(directory, filename)) throw new Error(`Character file escapes authoring directory: ${path}`)
      return readFile(filename)
    })
    for (const [path, bytes] of [
      [contribution.source, encodeCardBundleZip(bundle)],
      ...(contribution.preview ? [[contribution.preview, bundle.avatar.bytes] as const] : []),
    ] as Array<readonly [string, Uint8Array]>) {
      const outputPath = packagePath(path)
      if (sources.has(outputPath) || generated.has(outputPath)) throw new Error(`Shared contribution source: ${outputPath}`)
      sources.add(outputPath)
      generated.set(outputPath, bytes)
    }
  }
  // Reserve a new output directory before copying; failed builds remove only this directory.
  await mkdir(output)
  try {
    let count = 0
    let bytes = 0
    async function copy(directory: string, prefix = ''): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (['.git', '.loom', 'node_modules'].includes(entry.name) || (!prefix && entry.name === 'authoring')) continue
        const filename = join(directory, entry.name)
        if (excluded.has(filename)) continue
        if (entry.isSymbolicLink()) throw new Error(`Package symlinks are not supported: ${filename}`)
        const path = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) { await mkdir(join(output, path)); await copy(filename, path); continue }
        if (!entry.isFile()) throw new Error(`Unsupported package entry: ${path}`)
        if (++count > 10_000) throw new Error('Extension exceeds 10000 files')
        bytes += (await lstat(filename)).size
        if (bytes > 256 * 1024 * 1024) throw new Error('Extension exceeds 256 MiB')
        if (path !== 'manifest.json' && !generated.has(path)) await copyFile(filename, join(output, path))
      }
    }
    await copy(source)
    for (const [path, content] of generated) {
      await mkdir(dirname(join(output, path)), { recursive: true })
      await writeFile(join(output, path), content, { flag: 'wx' })
    }
    await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
    for (const contribution of contributions) {
      const artifact = JSON.parse(await readFile(join(output, packagePath(contribution.source)), 'utf8'))
      const icon = artifact.metadata?.icon
      if (icon?.kind === 'package' && icon.packageId === manifest.id) {
        if (!(await lstat(join(output, packagePath(icon.path)))).isFile()) throw new Error(`Missing icon asset: ${icon.path}`)
      }
    }
    for (const script of manifest.contributes?.loomScripts ?? []) {
      if (!(await lstat(join(output, packagePath(script.source)))).isFile()) throw new Error(`Missing script source: ${script.source}`)
    }
    // Reuse the existing package export validation without emitting a separate archive.
    await exportExtensionPackageZip(output, manifest)
    return { directory: output, packageId: manifest.id, version: manifest.version, contributions: [...mapped], characters: [...characterMappings] }
  } catch (error) {
    await rm(output, { recursive: true, force: true })
    throw error
  }
}
