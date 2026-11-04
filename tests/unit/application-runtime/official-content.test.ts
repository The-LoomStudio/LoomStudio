import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createApplicationRuntime, createOfficialAgentToolRegistry, officialPromptResourceIds, type PromptResourceArtifact } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createPromptResourceStore } from '@loom-studio/application-data'
import { describe, expect, it, onTestFinished } from 'vitest'

const starterDirectory = join(process.cwd(), 'tests/fixtures/legacy-official-starter')

describe('official content installation', () => {
  it('does not create official Prompt Resources during initialization', async () => {
    const fixture = createFixture()
    await fixture.runtime.initialize()

    await expect(fixture.promptResources.getResource(officialPromptResourceIds.assistantPreset, { includeTombstone: true })).resolves.toBeNull()
    await expect(fixture.promptResources.getResource(officialPromptResourceIds.knowledgeLore, { includeTombstone: true })).resolves.toBeNull()
  })

  it('restores missing tool mounts without enabling them or overwriting local content', async () => {
    const fixture = createFixture()
    await fixture.runtime.initialize()
    const input = await readStarterInput()

    const first = await fixture.runtime.installOfficialContent(input)
    expect(first.resources).toEqual([
      { id: officialPromptResourceIds.assistantPreset, created: true },
      { id: officialPromptResourceIds.knowledgeLore, created: true },
    ])
    expect(first.mutation?.changesetId).toBeTruthy()
    const initialTools = await fixture.runtime.listPresetToolMounts({ presetId: officialPromptResourceIds.assistantPreset })
    expect(initialTools.mounts.length).toBeGreaterThan(0)
    await expect(fixture.promptResources.listLoreMounts({
      source: { kind: 'preset', id: officialPromptResourceIds.assistantPreset },
    })).resolves.toHaveLength(1)

    const preset = await fixture.runtime.getPromptResource({ resourceId: officialPromptResourceIds.assistantPreset })
    await fixture.runtime.updatePromptResourceAsset({
      resourceId: preset.resource.id,
      assetId: 'official.loom-assistant.instructions',
      body: 'User edited instructions.',
    })
    await fixture.runtime.replaceLoreMounts({ expectedMountIds: (await fixture.runtime.listLoreMounts({ source: { kind: 'preset', id: preset.resource.id } })).mounts.map(mount => mount.id),
      source: { kind: 'preset', id: preset.resource.id },
      loreResourceIds: [],
    })
    await fixture.runtime.replacePresetToolMounts({ expectedMountIds: (await fixture.runtime.listPresetToolMounts({ presetId: preset.resource.id })).mounts.map(mount => mount.id), presetId: preset.resource.id, mounts: [] })

    const second = await fixture.runtime.installOfficialContent(input)
    expect(second.resources).toEqual(input.resources.map(resource => ({ id: resource.id, created: false })))
    expect(second.mutation?.changesetId).toBeTruthy()
    expect((await fixture.runtime.getPromptResource({ resourceId: preset.resource.id })).resource.rootNode.children?.[0]?.children?.[0]?.body).toBe('User edited instructions.')
    await expect(fixture.promptResources.listLoreMounts({ source: { kind: 'preset', id: preset.resource.id } })).resolves.toHaveLength(0)
    const restoredTools = await fixture.runtime.listPresetToolMounts({ presetId: preset.resource.id })
    expect(restoredTools.mounts.map(mount => mount.toolId)).toEqual(initialTools.mounts.map(mount => mount.toolId))
    expect(restoredTools.mounts.every(mount => !mount.defaultEnabled)).toBe(true)
    await expect(fixture.runtime.installOfficialContent(input)).resolves.toEqual({
      resources: input.resources.map(resource => ({ id: resource.id, created: false })),
    })

    await fixture.runtime.initialize()
    expect((await fixture.runtime.getPromptResource({ resourceId: preset.resource.id })).resource.rootNode.children?.[0]?.children?.[0]?.body).toBe('User edited instructions.')
    await expect(fixture.promptResources.listLoreMounts({ source: { kind: 'preset', id: preset.resource.id } })).resolves.toHaveLength(0)
    await expect(fixture.runtime.listPresetToolMounts({ presetId: preset.resource.id })).resolves.toEqual(restoredTools)
  })

  it.each(['same', 'updated'] as const)('restores deleted official resources with stable IDs on explicit reinstall (%s source)', async source => {
    const fixture = createFixture()
    await fixture.runtime.initialize()
    const input = await readStarterInput()
    await fixture.runtime.installOfficialContent(input)
    const setting = await fixture.runtime.getPromptResource({ resourceId: officialPromptResourceIds.knowledgeLore })
    const preset = await fixture.runtime.getPromptResource({ resourceId: officialPromptResourceIds.assistantPreset })
    const toolIds = (await fixture.runtime.listPresetToolMounts({ presetId: preset.resource.id })).mounts.map(mount => mount.toolId)
    await fixture.runtime.updatePromptResourceAsset({
      resourceId: preset.resource.id, assetId: 'official.loom-assistant.instructions', body: 'Local edit survives restoration.',
    })

    await fixture.runtime.deletePromptResource({ resourceId: setting.resource.id })
    await fixture.runtime.deletePromptResource({ resourceId: preset.resource.id })
    await fixture.runtime.initialize()
    await expect(fixture.promptResources.getResource(setting.resource.id, { includeTombstone: true })).resolves.toMatchObject({ tombstoned: true })
    if (source === 'updated') {
      input.packageVersion = '2.0.0'
      input.resources[0]!.artifact.rootNode.children![0]!.children![0]!.body = 'Updated source.'
    }
    const result = await fixture.runtime.installOfficialContent(input)

    expect(result.resources).toEqual(input.resources.map(resource => ({ id: resource.id, created: false })))
    expect(result.mutation?.changesetId).toBeTruthy()
    await expect(fixture.promptResources.getResource(setting.resource.id)).resolves.toMatchObject({
      id: setting.resource.id, rootNode: setting.resource.rootNode,
    })
    const restoredPreset = (await fixture.runtime.getPromptResource({ resourceId: preset.resource.id })).resource
    expect(restoredPreset.rootNode.children?.[0]?.children?.[0]?.body)
      .toBe(source === 'updated' ? 'Updated source.' : 'Local edit survives restoration.')
    await expect(fixture.promptResources.listLoreMounts({ source: { kind: 'preset', id: preset.resource.id } }))
      .resolves.toMatchObject([{ loreResourceId: setting.resource.id }])
    const restoredTools = (await fixture.runtime.listPresetToolMounts({ presetId: preset.resource.id })).mounts
    expect(restoredTools.map(mount => mount.toolId)).toEqual(toolIds)
    expect(restoredTools.every(mount => !mount.defaultEnabled)).toBe(true)
    await expect(fixture.runtime.installOfficialContent(input)).resolves.toEqual({ resources: result.resources })
  })

  it('validates artifacts and references before writing anything', async () => {
    const fixture = createFixture()
    const input = await readStarterInput()
    const invalidArtifact = structuredClone(input)
    invalidArtifact.resources[1]!.artifact.rootNode.id = invalidArtifact.resources[0]!.artifact.rootNode.id
    invalidArtifact.resources[1]!.artifact.resourceKind = 'preset'

    await expect(fixture.runtime.installOfficialContent(invalidArtifact)).rejects.toThrow('Lore reference is invalid')
    await expect(fixture.promptResources.getResource(officialPromptResourceIds.assistantPreset, { includeTombstone: true })).resolves.toBeNull()
    await expect(fixture.promptResources.getResource(officialPromptResourceIds.knowledgeLore, { includeTombstone: true })).resolves.toBeNull()

    const malformed = structuredClone(input)
    malformed.resources[1]!.artifact.format = 'invalid' as 'loom.promptResource'
    await expect(fixture.runtime.installOfficialContent(malformed)).rejects.toThrow('Unsupported Prompt Resource artifact format')
    await expect(fixture.promptResources.getResource(officialPromptResourceIds.assistantPreset, { includeTombstone: true })).resolves.toBeNull()
  })
})

function createFixture() {
  let sequence = 0
  const createId = (prefix: string) => `${prefix}-${++sequence}`
  const now = () => '2026-09-12T00:00:00.000Z'
  const dataEngine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  onTestFinished(() => dataEngine.close())
  const promptResources = createPromptResourceStore({ engine: dataEngine, createId, now })
  const runtime = createApplicationRuntime({
    dataEngine,
    documents: createSqliteDocumentStore({ engine: dataEngine }),
    promptResources,
    agentTools: createOfficialAgentToolRegistry(),
  })
  return { runtime, promptResources }
}

async function readStarterInput() {
  const catalog = JSON.parse(await readFile(join(starterDirectory, 'catalog.json'), 'utf8')) as {
    id: string
    version: string
    resources: Array<{ id: string; path: string }>
    loreMounts: Array<{ presetResourceId: string; loreResourceId: string }>
  }
  return {
    packageId: catalog.id,
    packageVersion: catalog.version,
    resources: await Promise.all(catalog.resources.map(async resource => ({
      id: resource.id,
      artifact: JSON.parse(await readFile(join(starterDirectory, resource.path), 'utf8')) as PromptResourceArtifact,
    }))),
    loreMounts: catalog.loreMounts,
  }
}
