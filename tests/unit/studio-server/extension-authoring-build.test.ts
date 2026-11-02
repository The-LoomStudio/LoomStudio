import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildExtensionAuthoring } from '../../../scripts/pack/extension-authoring.js'
import { loadResourceAuthoring, projectResourceAuthoring, writeResourceAuthoring } from '../../../apps/studio-server/src/codecs/resource-authoring.js'
import { installExtensionPackageFromDirectory } from '../../../apps/studio-server/src/extensions/extension-package-installer.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'loom-author-build-')); roots.push(root)
  const source = join(root, 'source'); await mkdir(source)
  await mkdir(join(source, 'assets')); await writeFile(join(source, 'assets/icon.png'), 'image')
  await writeFile(join(source, 'manifest.json'), JSON.stringify({ manifestVersion: 2, id: 'test.author', version: '1.0.0', displayName: 'Author', engines: { studio: '^0.1.0' }, contributes: {
    promptResources: [{ id: 'assistant', resourceKind: 'preset', source: './resources/assistant.json', textUses: [{ kind: 'rule', reference: { kind: 'external', resourceId: 'existing-rule' }, enabled: false }] }, { id: 'knowledge', resourceKind: 'lore', source: './resources/knowledge.json' }],
  } }))
  await writeResourceAuthoring(join(source, 'authoring/assistant'), {
    format: 'loom.resource.authoring', schemaVersion: 1, id: 'preset-resource', resourceKind: 'preset',
    rootNode: { id: 'preset-root', kind: 'module', label: 'Assistant', children: [] },
    metadata: { icon: { kind: 'package', packageId: 'test.author', path: 'assets/icon.png' } },
    macros: { name: 'Nom' }, loreMounts: [{ kind: 'package', contributionId: 'knowledge' }],
  })
  await writeResourceAuthoring(join(source, 'authoring/knowledge'), {
    format: 'loom.resource.authoring', schemaVersion: 1, id: 'lore-resource', resourceKind: 'lore',
    rootNode: { id: 'lore-root', kind: 'module', label: 'Knowledge', children: [{ id: 'entry', kind: 'entry', label: 'About', body: 'Knowledge text' }] },
  })
  return { root, source, output: join(root, 'output'), resources: [{ contributionId: 'assistant', directory: 'authoring/assistant' }, { contributionId: 'knowledge', directory: 'authoring/knowledge' }] }
}

describe('extension authoring build', () => {
  it('builds package contributions and assets, excludes authoring state, and installs through the existing installer', async () => {
    const item = await fixture()
    await mkdir(join(item.source, '.loom')); await writeFile(join(item.source, '.loom/authoring-state.json'), 'local')
    await buildExtensionAuthoring({ sourceDirectory: item.source, outputDirectory: item.output, resources: item.resources })
    const manifest = JSON.parse(await readFile(join(item.output, 'manifest.json'), 'utf8'))
    expect(manifest.contributes.promptResources[0].textUses).toEqual([{ kind: 'rule', reference: { kind: 'external', resourceId: 'existing-rule' }, enabled: false }])
    expect(manifest.contributes.promptResources[0].loreMounts).toEqual([{ reference: { kind: 'package', contributionId: 'knowledge' }, orderIndex: 0 }])
    const artifact = JSON.parse(await readFile(join(item.output, 'resources/assistant.json'), 'utf8'))
    expect(artifact).toMatchObject({ format: 'loom.promptResource', macros: { name: 'Nom' }, metadata: { icon: { path: 'assets/icon.png' } } })
    expect(artifact).not.toHaveProperty('id')
    await expect(access(join(item.output, 'authoring'))).rejects.toThrow()
    await expect(access(join(item.output, '.loom'))).rejects.toThrow()
    const installed = await installExtensionPackageFromDirectory({ sourceDirectory: item.output, installedDirectory: join(item.root, 'installed') })
    expect(installed.manifest.id).toBe('test.author')
    await expect(access(join(installed.directory, 'resources/knowledge.json'))).resolves.toBeUndefined()
  })
  it('rejects overlaps, duplicate mappings and existing outputs without overwriting', async () => {
    const item = await fixture()
    await expect(buildExtensionAuthoring({ sourceDirectory: item.source, outputDirectory: join(item.source, 'out'), resources: item.resources })).rejects.toThrow('overlap')
    await expect(buildExtensionAuthoring({ sourceDirectory: item.source, outputDirectory: item.output, resources: [...item.resources, item.resources[0]!] })).rejects.toThrow('Duplicate')
    await mkdir(item.output); await writeFile(join(item.output, 'keep'), 'user')
    await expect(buildExtensionAuthoring({ sourceDirectory: item.source, outputDirectory: item.output, resources: item.resources })).rejects.toThrow()
    expect(await readFile(join(item.output, 'keep'), 'utf8')).toBe('user')
  })
  it('does not leave a partial output when an icon asset is missing', async () => {
    const item = await fixture(); await rm(join(item.source, 'assets/icon.png'))
    await expect(buildExtensionAuthoring({ sourceDirectory: item.source, outputDirectory: item.output, resources: item.resources })).rejects.toThrow()
    await expect(access(item.output)).rejects.toThrow()
  })
  it('projects portable Tool references and requires declared external dependencies', async () => {
    const item = await fixture()
    const manifestPath = join(item.source, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.contributes.agentTools = [{ id: 'test.author/tool', source: './tool.json' }]
    await writeFile(join(item.source, 'tool.json'), JSON.stringify({ name: 'tool', description: 'Tool', input: { kind: 'structured', schema: { type: 'object' } } }))
    await writeFile(manifestPath, JSON.stringify(manifest))
    const authorDirectory = join(item.source, 'authoring/assistant')
    const resource = await loadResourceAuthoring(authorDirectory)
    const references = [
      { kind: 'host' as const, toolId: 'official.read_context' },
      { kind: 'package' as const, contributionId: 'test.author/tool' },
      { kind: 'external' as const, packageId: 'other.extension', contributionId: 'other.extension/tool', target: 'global' as const },
    ]
    resource.toolMounts = references.map((reference, orderIndex) => ({ reference, orderIndex, defaultEnabled: true }))
    await writeFile(join(authorDirectory, 'resource.yaml'), projectResourceAuthoring(resource).get('resource.yaml')!)
    await expect(buildExtensionAuthoring({ sourceDirectory: item.source, outputDirectory: item.output, resources: item.resources })).rejects.toThrow('Tool dependency is not declared')
    manifest.dependencies = [{ id: 'other.extension', version: '^1.0.0' }]
    await writeFile(manifestPath, JSON.stringify(manifest))
    await buildExtensionAuthoring({ sourceDirectory: item.source, outputDirectory: item.output, resources: item.resources })
    const result = JSON.parse(await readFile(join(item.output, 'manifest.json'), 'utf8'))
    expect(result.contributes.promptResources[0].toolMounts.map((mount: { reference: unknown }) => mount.reference)).toEqual(references)
    expect(result.contributes.promptResources[0].toolMounts.every((mount: { toolId?: string }) => mount.toolId === undefined)).toBe(true)
  })

  it.each(['global', 'card'] as const)('builds external %s icon references offline without copying dependency assets', async scope => {
    const item = await fixture()
    const manifestPath = join(item.source, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.dependencies = [{ id: 'shared.icons', version: '^1.0.0' }]
    await writeFile(manifestPath, JSON.stringify(manifest))
    const directory = join(item.source, 'authoring/assistant')
    const resource = await loadResourceAuthoring(directory)
    const icon = { kind: 'package' as const, packageId: 'shared.icons', path: 'assets/nom.png', scope }
    resource.metadata = { icon }
    await writeFile(join(directory, 'resource.yaml'), projectResourceAuthoring(resource).get('resource.yaml')!)
    await buildExtensionAuthoring({ sourceDirectory: item.source, outputDirectory: item.output, resources: item.resources })
    const artifact = JSON.parse(await readFile(join(item.output, 'resources/assistant.json'), 'utf8'))
    expect(artifact.metadata.icon).toEqual(icon)
    await expect(access(join(item.output, 'assets/nom.png'))).rejects.toThrow()
  })
  it('rejects cross-package icons without an explicit scope or dependency declaration', async () => {
    const item = await fixture()
    const directory = join(item.source, 'authoring/assistant')
    const resource = await loadResourceAuthoring(directory)
    resource.metadata = { icon: { kind: 'package', packageId: 'unknown.icons', path: 'assets/nom.png' } }
    await writeFile(join(directory, 'resource.yaml'), projectResourceAuthoring(resource).get('resource.yaml')!)
    await expect(buildExtensionAuthoring({ sourceDirectory: item.source, outputDirectory: item.output, resources: item.resources })).rejects.toThrow('requires an installation scope')
    resource.metadata.icon!.scope = 'global'
    await writeFile(join(directory, 'resource.yaml'), projectResourceAuthoring(resource).get('resource.yaml')!)
    await expect(buildExtensionAuthoring({ sourceDirectory: item.source, outputDirectory: item.output, resources: item.resources })).rejects.toThrow('Icon dependency is not declared')
  })

})
