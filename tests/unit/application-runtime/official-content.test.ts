import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createApplicationRuntime, createOfficialAgentToolRegistry, officialPromptResourceIds, type PromptResourceArtifact } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createPromptResourceStore } from '@loom-studio/prompt-resource-store'
import { describe, expect, it } from 'vitest'

const starterDirectory = join(process.cwd(), 'official/starter')

describe('official content installation', () => {
  it('does not create official Prompt Resources during initialization', async () => {
    const fixture = createFixture()
    await fixture.runtime.initialize()

    await expect(fixture.promptResources.getResource(officialPromptResourceIds.assistantPreset, { includeTombstone: true })).resolves.toBeNull()
    await expect(fixture.promptResources.getResource(officialPromptResourceIds.knowledgeSetting, { includeTombstone: true })).resolves.toBeNull()
  })

  it('installs missing resources once and preserves existing content and mounts', async () => {
    const fixture = createFixture()
    await fixture.runtime.initialize()
    const input = await readStarterInput()

    const first = await fixture.runtime.installOfficialContent(input)
    expect(first.resources).toEqual([
      { id: officialPromptResourceIds.assistantPreset, created: true },
      { id: officialPromptResourceIds.knowledgeSetting, created: true },
    ])
    expect(first.mutation?.changesetId).toBeTruthy()
    await expect(fixture.promptResources.listSettingMounts({
      source: { kind: 'preset', id: officialPromptResourceIds.assistantPreset },
    })).resolves.toHaveLength(1)

    const preset = await fixture.runtime.getPromptResource({ resourceId: officialPromptResourceIds.assistantPreset })
    await fixture.runtime.updatePromptResourceAsset({
      resourceId: preset.resource.id,
      assetId: 'official.loom-assistant.instructions',
      body: 'User edited instructions.',
    })
    await fixture.runtime.replaceSettingMounts({
      source: { kind: 'preset', id: preset.resource.id },
      settingResourceIds: [],
    })
    await fixture.runtime.replacePresetToolMounts({ presetId: preset.resource.id, mounts: [] })

    const second = await fixture.runtime.installOfficialContent(input)
    expect(second).toEqual({ resources: input.resources.map(resource => ({ id: resource.id, created: false })) })
    expect((await fixture.runtime.getPromptResource({ resourceId: preset.resource.id })).resource.rootNode.children?.[0]?.children?.[0]?.body).toBe('User edited instructions.')
    await expect(fixture.promptResources.listSettingMounts({ source: { kind: 'preset', id: preset.resource.id } })).resolves.toHaveLength(0)
    await expect(fixture.runtime.listPresetToolMounts({ presetId: preset.resource.id })).resolves.toEqual({ mounts: [] })

    await fixture.runtime.initialize()
    expect((await fixture.runtime.getPromptResource({ resourceId: preset.resource.id })).resource.rootNode.children?.[0]?.children?.[0]?.body).toBe('User edited instructions.')
    await expect(fixture.promptResources.listSettingMounts({ source: { kind: 'preset', id: preset.resource.id } })).resolves.toHaveLength(0)
    await expect(fixture.runtime.listPresetToolMounts({ presetId: preset.resource.id })).resolves.toEqual({ mounts: [] })
  })

  it('does not restore a deleted official resource on restart or reinstall', async () => {
    const fixture = createFixture()
    await fixture.runtime.initialize()
    const input = await readStarterInput()
    await fixture.runtime.installOfficialContent(input)
    const setting = await fixture.runtime.getPromptResource({ resourceId: officialPromptResourceIds.knowledgeSetting })

    await fixture.runtime.deletePromptResource({ resourceId: setting.resource.id, expectedVersion: setting.resource.version })
    await fixture.runtime.initialize()
    const result = await fixture.runtime.installOfficialContent(input)

    expect(result.resources.find(resource => resource.id === setting.resource.id)?.created).toBe(false)
    await expect(fixture.promptResources.getResource(setting.resource.id, { includeTombstone: true })).resolves.toMatchObject({ tombstoned: true })
  })

  it('validates artifacts and references before writing anything', async () => {
    const fixture = createFixture()
    const input = await readStarterInput()
    const invalidArtifact = structuredClone(input)
    invalidArtifact.resources[1]!.artifact.rootNode.id = invalidArtifact.resources[0]!.artifact.rootNode.id
    invalidArtifact.resources[1]!.artifact.resourceKind = 'preset'

    await expect(fixture.runtime.installOfficialContent(invalidArtifact)).rejects.toThrow('Setting reference is invalid')
    await expect(fixture.promptResources.getResource(officialPromptResourceIds.assistantPreset, { includeTombstone: true })).resolves.toBeNull()
    await expect(fixture.promptResources.getResource(officialPromptResourceIds.knowledgeSetting, { includeTombstone: true })).resolves.toBeNull()

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
    settingMounts: Array<{ presetResourceId: string; settingResourceId: string }>
  }
  return {
    packageId: catalog.id,
    packageVersion: catalog.version,
    resources: await Promise.all(catalog.resources.map(async resource => ({
      id: resource.id,
      artifact: JSON.parse(await readFile(join(starterDirectory, resource.path), 'utf8')) as PromptResourceArtifact,
    }))),
    settingMounts: catalog.settingMounts,
  }
}
