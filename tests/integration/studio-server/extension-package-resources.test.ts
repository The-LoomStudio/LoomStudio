import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { officialFakeModelId } from '@loom-studio/ai-gateway'
import { callRpc, withStudioServer } from './helpers.js'

describe('Studio Server Extension Package resources', () => {
  it('imports declared Preset, Setting, and Agent Tools while keeping handlers lifecycle-bound', async () => {
    await withStudioServer(async (port, root) => {
      const sourceDirectory = await writeCapabilityPackage(root)
      const installed = await callRpc<{ package: { resources: Record<string, unknown> } }>(port, 'extensions.installPackage', { sourceDirectory })
      expect(installed.package.resources).toMatchObject({
        promptResources: [
          { id: 'setting', resourceKind: 'setting' },
          { id: 'preset', resourceKind: 'preset' },
        ],
        agentTools: [
          { id: 'example.package-resources/echo' },
          { id: 'example.package-resources/content_echo' },
        ],
      })

      const imported = await callRpc<{
        promptResources: Array<{ contributionId: string; resourceId: string }>
        agentTools: Array<{ toolId: string }>
      }>(port, 'extensions.importPackageResources', { packageId: 'example.package-resources' })
      expect(imported.promptResources).toHaveLength(2)
      expect(imported.agentTools).toEqual([
        { contributionId: 'example.package-resources/echo', toolId: 'example.package-resources/echo' },
        { contributionId: 'example.package-resources/content_echo', toolId: 'example.package-resources/content_echo' },
      ])

      const resources = await callRpc<{ resources: Array<{ id: string; resourceKind: string; origin?: Record<string, unknown> }> }>(
        port,
        'application.listPromptResources',
        {},
      )
      const importedResources = resources.resources.filter(resource => resource.origin?.packageId === 'example.package-resources')
      expect(importedResources).toEqual(expect.arrayContaining([
        expect.objectContaining({ resourceKind: 'preset', origin: expect.objectContaining({ contributionId: 'preset' }) }),
        expect.objectContaining({ resourceKind: 'setting', origin: expect.objectContaining({ contributionId: 'setting' }) }),
      ]))
      const preset = importedResources.find(resource => resource.resourceKind === 'preset')!
      const setting = importedResources.find(resource => resource.resourceKind === 'setting')!

      await expect(callRpc<{ mounts: Array<{ settingResourceId: string }> }>(port, 'application.listSettingMounts', {
        source: { kind: 'preset', id: preset.id },
      })).resolves.toMatchObject({ mounts: [{ settingResourceId: setting.id }] })
      await expect(callRpc<{ mounts: Array<{ toolId: string; defaultEnabled: boolean }> }>(port, 'application.listPresetToolMounts', {
        presetId: preset.id,
      })).resolves.toMatchObject({
        mounts: [
          { toolId: 'example.package-resources/echo', defaultEnabled: false },
          {
            toolId: 'example.package-resources/content_echo',
            defaultEnabled: true,
            content: { targetAnchorId: '@chat.tools', localDepth: 100 },
          },
        ],
      })
      await expect(callRpc<{ tools: Array<{ id: string; origin?: Record<string, unknown> }> }>(port, 'application.listAgentTools', {})).resolves.toMatchObject({
        tools: expect.arrayContaining([
          expect.objectContaining({
            id: 'example.package-resources/echo',
            origin: expect.objectContaining({ packageId: 'example.package-resources' }),
          }),
          expect.objectContaining({
            id: 'example.package-resources/content_echo',
            origin: expect.objectContaining({ packageId: 'example.package-resources' }),
          }),
        ]),
      })

      await callRpc(port, 'extensions.enableModule', { packageId: 'example.package-resources', moduleId: 'server' })
      const active = await callRpc<{ items: Array<{ packageId: string; modules: Array<{ moduleId: string; runtime?: { state?: string } }> }> }>(port, 'extensions.listPackages', {})
      expect(active.items.find(item => item.packageId === 'example.package-resources')?.modules[0]?.runtime?.state).toBe('active')
      await expect(callRpc<{ diagnostics: Array<{ code: string }> }>(port, 'extensions.getDiagnostics', {
        packageId: 'example.package-resources',
        moduleId: 'server',
      })).resolves.toMatchObject({ diagnostics: [] })

      const provider = await callRpc<{ providerProfile: { id: string } }>(port, 'application.createProviderProfile', {
        providerExtensionId: 'official.fake',
        displayName: 'Extension Package Resource Test Provider',
        config: { baseUrl: 'https://example.test/v1' },
        enabledModelIds: [officialFakeModelId],
      })
      const profile = await callRpc<{ agentProfile: { id: string } }>(port, 'application.createAgentProfile', {
        name: 'Extension Package Resource Test Agent',
        presetId: preset.id,
        model: { providerProfileId: provider.providerProfile.id, modelId: officialFakeModelId },
      })
      const session = await callRpc<{ session: { id: string } }>(port, 'application.createAgentSession', {
        agentProfileId: profile.agentProfile.id,
      })
      await expect(callRpc<{
        toolExposures: Array<{ toolId: string; transport: string }>
        projection: { messages: Array<unknown> }
      }>(port, 'application.previewAgentTurn', {
        agentSessionId: session.session.id,
        input: 'Preview the Extension tool.',
      })).resolves.toMatchObject({
        toolExposures: [{ toolId: 'example.package-resources/content_echo', transport: 'content' }],
        projection: {
          messages: expect.any(Array),
        },
      })
      await expect(callRpc(port, 'extensions.removePackageResources', {
        packageId: 'example.package-resources',
      })).rejects.toThrow('still referenced by Agent Profiles')

      await callRpc(port, 'extensions.disableModule', { packageId: 'example.package-resources', moduleId: 'server' })
      await callRpc(port, 'extensions.enableModule', { packageId: 'example.package-resources', moduleId: 'server' })
      const importedAgain = await callRpc<typeof imported>(port, 'extensions.importPackageResources', { packageId: 'example.package-resources' })
      expect(importedAgain.promptResources).toEqual(imported.promptResources)
    })
  })

  it('removes imported resources, Tool Definitions, and cross-Preset Tool Mounts', async () => {
    await withStudioServer(async (port, root) => {
      const sourceDirectory = await writeCapabilityPackage(root)
      await callRpc(port, 'extensions.installPackage', { sourceDirectory })
      await callRpc(port, 'extensions.importPackageResources', { packageId: 'example.package-resources' })
      const localPreset = await callRpc<{ resource: { id: string } }>(port, 'application.createPromptResource', {
        resourceKind: 'preset',
        name: 'Local Preset',
      })
      await callRpc(port, 'application.replacePresetToolMounts', {
        presetId: localPreset.resource.id,
        mounts: [{
          toolId: 'example.package-resources/content_echo',
          orderIndex: 0,
          defaultEnabled: true,
          content: { targetAnchorId: '@chat.tools', localDepth: 0 },
        }],
      })

      const removed = await callRpc<{
        promptResourceIds: string[]
        agentToolIds: string[]
        detachedReferences: { presetToolMounts: number }
      }>(port, 'extensions.removePackageResources', { packageId: 'example.package-resources' })
      expect(removed.promptResourceIds).toHaveLength(2)
      expect(removed.agentToolIds).toEqual([
        'example.package-resources/content_echo',
        'example.package-resources/echo',
      ])
      expect(removed.detachedReferences.presetToolMounts).toBe(3)

      const resources = await callRpc<{ resources: Array<{ origin?: { packageId?: string } }> }>(port, 'application.listPromptResources', {})
      expect(resources.resources.some(resource => resource.origin?.packageId === 'example.package-resources')).toBe(false)
      const tools = await callRpc<{ tools: Array<{ id: string }> }>(port, 'application.listAgentTools', {})
      expect(tools.tools.some(tool => tool.id.startsWith('example.package-resources/'))).toBe(false)
      await expect(callRpc<{ mounts: Array<{ toolId: string }> }>(port, 'application.listPresetToolMounts', {
        presetId: localPreset.resource.id,
      })).resolves.toEqual({ mounts: [] })

      await expect(callRpc(port, 'extensions.removePackageResources', {
        packageId: 'example.package-resources',
      })).resolves.toMatchObject({ promptResourceIds: [], agentToolIds: [] })

      await expect(callRpc(port, 'extensions.importPackageResources', {
        packageId: 'example.package-resources',
      })).resolves.toMatchObject({
        promptResources: expect.any(Array),
        agentTools: [
          { toolId: 'example.package-resources/echo' },
          { toolId: 'example.package-resources/content_echo' },
        ],
      })
    })
  })

  it('requires an explicit migration before importing a different Package version', async () => {
    await withStudioServer(async (port, root) => {
      const sourceDirectory = await writeVersionedResourcePackage(root, '1.0.0', 'old-setting')
      await callRpc(port, 'extensions.installPackage', { sourceDirectory })
      await callRpc(port, 'extensions.importPackageResources', { packageId: 'example.package-versioned-resources' })
      await callRpc(port, 'extensions.uninstallPackage', {
        packageId: 'example.package-versioned-resources',
        version: '1.0.0',
      })

      await writeVersionedResourcePackage(root, '2.0.0', 'new-setting')
      await callRpc(port, 'extensions.installPackage', { sourceDirectory })
      await expect(callRpc(port, 'extensions.importPackageResources', {
        packageId: 'example.package-versioned-resources',
      })).rejects.toThrow('explicit migration')
    })
  })
})

async function writeCapabilityPackage(root: string): Promise<string> {
  const directory = join(root, 'capability-package')
  await mkdir(join(directory, 'dist'), { recursive: true })
  await mkdir(join(directory, 'resources'), { recursive: true })
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({
    manifestVersion: 2,
    id: 'example.package-resources',
    version: '1.0.0',
    displayName: 'Package Resources',
    engines: { studio: '^0.1.0' },
    modules: [{
      id: 'server',
      runtime: 'server',
      entry: './dist/index.js',
      contributes: {
        agentToolHandlers: [
          { toolId: 'example.package-resources/echo' },
          { toolId: 'example.package-resources/content_echo' },
        ],
      },
    }],
    contributes: {
      promptResources: [
        { id: 'setting', resourceKind: 'setting', source: './resources/setting.json' },
        {
          id: 'preset',
          resourceKind: 'preset',
          source: './resources/preset.json',
          settingMounts: [{ resourceId: 'setting' }],
          toolMounts: [
            { toolId: 'example.package-resources/echo', defaultEnabled: false },
            {
              toolId: 'example.package-resources/content_echo',
              defaultEnabled: true,
              content: { targetAnchorId: '@chat.tools', localDepth: 100 },
            },
          ],
        },
      ],
      agentTools: [
        { id: 'example.package-resources/echo', source: './resources/echo.json' },
        { id: 'example.package-resources/content_echo', source: './resources/content-echo.json' },
      ],
    },
  }))
  await writeFile(join(directory, 'resources/setting.json'), JSON.stringify(promptResource('setting', 'setting')))
  await writeFile(join(directory, 'resources/preset.json'), JSON.stringify(promptResource('preset', 'preset')))
  await writeFile(join(directory, 'resources/echo.json'), JSON.stringify({
    name: 'extension_echo',
    description: 'Echo a value through an Extension Tool Handler.',
    input: {
      kind: 'structured',
      schema: {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
        additionalProperties: false,
      },
    },
  }))
  await writeFile(join(directory, 'resources/content-echo.json'), JSON.stringify({
    name: 'extension_content_echo',
    description: 'Echo raw text through an Extension Content Tool Handler.',
    input: {
      kind: 'freeform',
      mediaType: 'text/plain',
    },
    prompt: {
      guidance: 'Send raw text through the active Content Tool protocol.',
    },
  }))
  await writeFile(join(directory, 'dist/index.js'), `
export function activate(ctx) {
  ctx.agentTools.register('example.package-resources/echo', input => ({ value: input.arguments?.value ?? '' }))
  ctx.agentTools.register('example.package-resources/content_echo', input => input.rawInput ?? '')
}
`)
  return directory
}

async function writeVersionedResourcePackage(root: string, version: string, contributionId: string): Promise<string> {
  const directory = join(root, 'versioned-resource-package')
  await mkdir(join(directory, 'resources'), { recursive: true })
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({
    manifestVersion: 2,
    id: 'example.package-versioned-resources',
    version,
    displayName: 'Versioned Package Resources',
    engines: { studio: '^0.1.0' },
    contributes: {
      promptResources: [{
        id: contributionId,
        resourceKind: 'setting',
        source: `./resources/${contributionId}.json`,
      }],
    },
  }))
  await writeFile(
    join(directory, `resources/${contributionId}.json`),
    JSON.stringify(promptResource('setting', contributionId, 'example.package-versioned-resources')),
  )
  return directory
}

function promptResource(resourceKind: 'preset' | 'setting', id: string, packageId = 'example.package-resources') {
  return {
    format: 'loom.promptResource',
    schemaVersion: 1,
    resourceKind,
    rootNode: {
      id: `${packageId}.${id}`,
      label: id,
      category: resourceKind,
      kind: 'module',
      children: [{
        id: `${packageId}.${id}.entry`,
        label: `${id} entry`,
        category: resourceKind,
        kind: 'entry',
        body: `${id} body`,
      }],
    },
  }
}
