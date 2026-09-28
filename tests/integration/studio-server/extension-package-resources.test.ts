import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { officialFakeModelId } from '@loom-studio/ai-gateway'
import { unzipSync, zipSync } from 'fflate'
import { authenticatedFetch, callRpc, withStudioServer } from './helpers.js'

describe('Studio Server Extension Package resources', () => {
  it('installs and updates sandbox script resources without enabling them or mixing Card installations', async () => {
    await withStudioServer(async port => {
      const packageId = 'example.sandbox-resources'
      const source = [
        '// ==LoomScript==', '// @format 1', '// @id example.scene', '// @name Scene',
        '// @version 1.0.0', '// @runtime client-sandbox', '// @capability state.read',
        '// @contribution {"kind":"renderer","id":"scene","surface":"narrative.timeline.tail","scope":"timeline","inputs":["match:rule"]}',
        '// ==/LoomScript==', 'export const value = 1',
      ].join('\n')
      const archive = (version: string, scriptSource?: string) => ({
        packageId, version,
        archiveBase64: Buffer.from(zipSync({
          'manifest.json': new TextEncoder().encode(JSON.stringify({
            manifestVersion: 2, id: packageId, version, displayName: 'Sandbox resources', engines: { studio: '^0.1.0' },
            contributes: {
              loomScripts: scriptSource ? [{ id: 'scene', source: './scene.loom.js' }] : [],
              promptResources: [{
                id: 'writer', resourceKind: 'preset', source: './writer.json',
                scriptMounts: scriptSource ? [{ scriptId: 'scene' }] : [],
              }],
              transformRules: [{ id: 'rule', source: './rule.json' }],
            },
          })),
          'writer.json': new TextEncoder().encode(JSON.stringify(promptResource('preset', 'writer', packageId))),
          'rule.json': new TextEncoder().encode(JSON.stringify({
            name: 'Rule', enabled: true, orderIndex: 0, matcher: { kind: 'regex', pattern: '(x)', flags: 'g' },
            effect: { kind: 'promote-reasoning', contentGroup: 1, visibility: 'collapsed', replay: 'omit' },
            targets: ['agent-session'], phases: ['classify'],
          })),
          ...(scriptSource ? { 'scene.loom.js': new TextEncoder().encode(scriptSource) } : {}),
        })).toString('base64'),
      })
      const cards: Array<{ id: string; version: number; presetId: string; timelineId: string; scriptId: string }> = []
      for (const name of ['A', 'B']) {
        const { card } = await callRpc<{ card: { id: string; version: number } }>(port, 'application.importCardBundle', {
          artifact: { schemaVersion: 4, artifactId: name, displayName: name, card: { name }, contextAssets: [], extensionPackages: [archive('1.0.0', source)] },
        })
        const imported = await callRpc<{ promptResources: Array<{ resourceId: string }>; loomScripts: Array<{ scriptId: string }> }>(
          port, 'extensions.importCardPackageResources', { cardId: card.id, packageId, expectedCardVersion: card.version },
        )
        const { timeline } = await callRpc<{ timeline: { id: string } }>(port, 'application.createNarrativeTimeline', { cardId: card.id })
        const presetId = imported.promptResources[0]!.resourceId
        cards.push({ ...card, presetId, timelineId: timeline.id, scriptId: imported.loomScripts[0]!.scriptId })
        const { mounts } = await callRpc<{ mounts: Array<{ enabled: boolean; grantedCapabilities: string[] }> }>(
          port, 'application.listLoomScriptMounts', { target: { kind: 'preset', presetId } },
        )
        expect(mounts).toHaveLength(1)
        expect(mounts[0]).toMatchObject({ enabled: false, grantedCapabilities: [] })
      }
      expect(cards[0]!.scriptId).not.toBe(cards[1]!.scriptId)
      const a = cards[0]!
      const { mounts } = await callRpc<{ mounts: Array<{ id: string; version: number }> }>(port, 'application.listLoomScriptMounts', {
        target: { kind: 'preset', presetId: a.presetId },
      })
      const mount = mounts[0]!
      await expect(callRpc(port, 'application.updateLoomScriptMount', {
        mountId: mount.id, expectedVersion: mount.version, enabled: true, orderIndex: 0, grantedCapabilities: [], pinnedDocumentVersion: 1,
      })).rejects.toThrow('cannot pin')
      await callRpc(port, 'application.updateLoomScriptMount', {
        mountId: mount.id, expectedVersion: mount.version, enabled: true, orderIndex: 0, grantedCapabilities: ['state.read'],
      })
      const resolve = (card: typeof a) => callRpc<{ mounts: Array<{ source: string; enabled: boolean; grantedCapabilities: string[]; script: { contributions: Array<{ inputs: Array<{ ruleId: string }> }> } }> }>(
        port, 'application.resolveLoomScriptRendererMounts', { timelineId: card.timelineId, presetId: card.presetId },
      )
      const first = await resolve(a)
      expect(first.mounts[0]!.script.contributions[0]!.inputs[0]!.ruleId).not.toBe('rule')
      const update = async (version: string, scriptSource?: string) => {
        const { installations } = await callRpc<{ installations: Array<{ version: number; target: { cardId: string } }> }>(port, 'application.listExtensionInstallations', {})
        const current = await callRpc<{ card: { version: number } }>(port, 'application.getCard', { cardId: a.id })
        const attached = await callRpc<{ card: { version: number } }>(port, 'application.attachCardExtensionPackage', {
          cardId: a.id, expectedVersion: current.card.version, archive: archive(version, scriptSource),
        })
        await callRpc(port, 'extensions.updateCardPackage', {
          cardId: a.id, packageId, packageVersion: version, expectedCardVersion: attached.card.version,
          expectedInstallationVersion: installations.find(item => item.target.cardId === a.id)!.version,
        })
      }
      await update('2.0.0', source.replace('value = 1', 'value = 2'))
      expect((await resolve(a)).mounts[0]).toMatchObject({ enabled: true, grantedCapabilities: ['state.read'], source: expect.stringContaining('value = 2') })
      expect((await resolve(cards[1]!)).mounts[0]).toMatchObject({ enabled: false, source: expect.stringContaining('value = 1') })
      await update('3.0.0')
      expect((await resolve(a)).mounts).toEqual([])
      await expect(callRpc(port, 'application.getLoomScript', { scriptDocumentId: a.scriptId })).rejects.toThrow('not found')
      expect((await resolve(cards[1]!)).mounts).toHaveLength(1)
      await update('4.0.0', source)
      expect((await resolve(a)).mounts[0]).toMatchObject({ enabled: false, grantedCapabilities: [] })
    })
  })

  it('installs an offline resource-only archive separately for two Cards without a global package', async () => {
    await withStudioServer(async (port, root) => {
      const directory = await writeVersionedResourcePackage(root, '1.0.0', 'clothes')
      const packageId = 'example.package-versioned-resources'
      const archiveBase64 = Buffer.from(zipSync({
        'manifest.json': await readFile(join(directory, 'manifest.json')),
        'resources/clothes.json': await readFile(join(directory, 'resources/clothes.json')),
      })).toString('base64')
      const digest = createHash('sha256').update(Buffer.from(archiveBase64, 'base64')).digest('hex')
      const importedIds: string[] = []
      for (const name of ['A', 'B']) {
        const { card } = await callRpc<{ card: { id: string; version: number } }>(port, 'application.importCardBundle', {
          artifact: {
            schemaVersion: 4, artifactId: name, displayName: name, card: { name }, contextAssets: [],
            extensionPackages: [{ packageId, version: '1.0.0', archiveBase64 }],
          },
        })
        const fileUrl = `/card-extensions/${encodeURIComponent(card.id)}/${packageId}/1.0.0/${digest}/files/resources/clothes.json`
        expect((await authenticatedFetch(port, fileUrl)).status).toBe(404)
        await expect(callRpc(port, 'extensions.importCardPackageResources', {
          cardId: card.id, expectedCardVersion: card.version + 1, packageId,
        })).rejects.toThrow('Card archive changed')
        const result = await callRpc<{ promptResources: Array<{ resourceId: string }> }>(port, 'extensions.importCardPackageResources', {
          cardId: card.id, expectedCardVersion: card.version, packageId,
        })
        importedIds.push(result.promptResources[0]!.resourceId)
        const file = await authenticatedFetch(port, fileUrl)
        expect(file.status).toBe(200)
        expect(await file.json()).toEqual(promptResource('setting', 'clothes', packageId))
        expect((await authenticatedFetch(port, fileUrl.replace('/1.0.0/', '/9.0.0/'))).status).toBe(404)
        expect((await authenticatedFetch(port, fileUrl.replace('resources/clothes.json', '%2e%2e%2fmanifest.json'))).status).toBe(404)
      }
      expect(new Set(importedIds).size).toBe(2)
      const { installations } = await callRpc<{ installations: Array<{ version: number; target: { kind: string; cardId: string } }> }>(
        port, 'application.listExtensionInstallations', {},
      )
      expect(installations).toHaveLength(2)
      expect(installations.every(item => item.target.kind === 'card')).toBe(true)
      expect(new Set(installations.map(item => item.target.cardId)).size).toBe(2)
      const packages = await callRpc<{ items: Array<{ packageId: string }> }>(port, 'extensions.listPackages', {})
      expect(packages.items.some(item => item.packageId === packageId)).toBe(false)
      const a = installations[0]!
      const { card } = await callRpc<{ card: { id: string; version: number } }>(port, 'application.getCard', { cardId: a.target.cardId })
      await writeVersionedResourcePackage(root, '2.0.0', 'new-clothes')
      const nextArchive = {
        packageId, version: '2.0.0',
        archiveBase64: Buffer.from(zipSync({
          'manifest.json': await readFile(join(directory, 'manifest.json')),
          'resources/new-clothes.json': await readFile(join(directory, 'resources/new-clothes.json')),
        })).toString('base64'),
      }
      const attached = await callRpc<{ card: { version: number } }>(port, 'application.attachCardExtensionPackage', {
        cardId: card.id, expectedVersion: card.version, archive: nextArchive,
      })
      const nextDigest = createHash('sha256').update(Buffer.from(nextArchive.archiveBase64, 'base64')).digest('hex')
      const oldFileUrl = `/card-extensions/${encodeURIComponent(card.id)}/${packageId}/1.0.0/${digest}/files/resources/clothes.json`
      const newFileUrl = `/card-extensions/${encodeURIComponent(card.id)}/${packageId}/2.0.0/${nextDigest}/files/resources/new-clothes.json`
      expect((await authenticatedFetch(port, oldFileUrl)).status).toBe(200)
      expect((await authenticatedFetch(port, newFileUrl)).status).toBe(404)
      const updated = await callRpc<{ promptResources: Array<{ resourceId: string }> }>(port, 'extensions.updateCardPackageResources', {
        cardId: card.id, packageId, expectedCardVersion: attached.card.version,
        packageVersion: '2.0.0', expectedInstallationVersion: a.version,
      })
      expect((await authenticatedFetch(port, oldFileUrl)).status).toBe(404)
      expect(await (await authenticatedFetch(port, newFileUrl)).json()).toEqual(promptResource('setting', 'new-clothes', packageId))
      const replaced = await callRpc<{ card: { version: number } }>(port, 'application.attachCardExtensionPackage', {
        cardId: card.id, expectedVersion: attached.card.version,
        archive: {
          ...nextArchive,
          archiveBase64: Buffer.from(zipSync({
            ...unzipSync(Buffer.from(nextArchive.archiveBase64, 'base64')),
            'replacement.txt': new TextEncoder().encode('same-version replacement'),
          })).toString('base64'),
        },
      })
      await expect(callRpc(port, 'extensions.importCardPackageResources', {
        cardId: card.id, expectedCardVersion: replaced.card.version, packageId,
      })).rejects.toThrow('explicit package update')
      expect((await authenticatedFetch(port, newFileUrl.replace('resources/new-clothes.json', 'replacement.txt'))).status).toBe(404)
      await callRpc(port, 'application.detachCardExtensionPackage', {
        cardId: card.id, expectedVersion: replaced.card.version, packageId,
      })
      expect((await authenticatedFetch(port, newFileUrl)).status).toBe(200)
      await expect(callRpc(port, 'extensions.removeCardPackageResources', {
        cardId: card.id, packageId, expectedInstallationVersion: a.version,
      })).rejects.toThrow('installation changed')
      const current = await callRpc<{ installations: Array<{ version: number; target: { cardId: string } }> }>(port, 'application.listExtensionInstallations', {})
      await callRpc(port, 'extensions.removeCardPackageResources', {
        cardId: card.id, packageId, expectedInstallationVersion: current.installations.find(item => item.target.cardId === card.id)!.version,
      })
      await expect(callRpc(port, 'application.getPromptResource', { resourceId: updated.promptResources[0]!.resourceId })).rejects.toThrow('not found')
      const remaining = await callRpc<{ resources: Array<{ origin?: { packageId: string; packageVersion: string } }> }>(port, 'application.listPromptResources', {})
      expect(remaining.resources.filter(item => item.origin?.packageId === packageId)).toHaveLength(1)
      expect(remaining.resources.find(item => item.origin?.packageId === packageId)?.origin?.packageVersion).toBe('1.0.0')
    })
  })

  it('exports discovered package files for offline Card distribution without activating modules', async () => {
    await withStudioServer(async (port, root) => {
      const sourceDirectory = await writeCapabilityPackage(root)
      await writeFile(join(sourceDirectory, 'binary.dat'), new Uint8Array([0, 128, 255]))
      await mkdir(join(sourceDirectory, 'empty'))
      await callRpc(port, 'extensions.installPackage', { sourceDirectory })
      await expect(callRpc(port, 'extensions.exportPackage', { packageId: 'example.package-resources', version: '0.0.0' }))
        .rejects.toThrow('review the export again')
      const archive = await callRpc<{ packageId: string; version: string; archiveBase64: string }>(port, 'extensions.exportPackage', {
        packageId: 'example.package-resources', version: '1.0.0',
      })
      const files = unzipSync(Buffer.from(archive.archiveBase64, 'base64'))
      expect(files['binary.dat']).toEqual(new Uint8Array([0, 128, 255]))
      expect(files['empty/']).toEqual(new Uint8Array())
      expect(JSON.parse(new TextDecoder().decode(files['manifest.json']))).toMatchObject({ id: archive.packageId, version: archive.version })
      const imported = await callRpc<{ card: { id: string; version: number } }>(port, 'application.createCard', { name: 'Offline' })
      const attached = await callRpc<{ card: { version: number } }>(port, 'application.attachCardExtensionPackage', {
        cardId: imported.card.id, expectedVersion: imported.card.version, archive,
      })
      await expect(callRpc(port, 'application.attachCardExtensionPackage', {
        cardId: imported.card.id, expectedVersion: imported.card.version, archive,
      })).rejects.toThrow('Card changed')
      const exported = await callRpc<{ artifact: { extensionPackages: unknown[] } }>(port, 'application.exportCardBundle', { cardId: imported.card.id })
      expect(exported.artifact.extensionPackages).toEqual([archive])
      await expect(callRpc(port, 'extensions.importCardPackageResources', {
        cardId: imported.card.id, expectedCardVersion: attached.card.version, packageId: archive.packageId,
      })).rejects.toThrow('only resource-only packages')
      await expect(callRpc(port, 'application.detachCardExtensionPackage', {
        cardId: imported.card.id, expectedVersion: imported.card.version, packageId: archive.packageId,
      })).rejects.toThrow('Card changed')
      await callRpc(port, 'application.detachCardExtensionPackage', {
        cardId: imported.card.id, expectedVersion: attached.card.version, packageId: archive.packageId,
      })
      expect((await callRpc<{ artifact: { extensionPackages: unknown[] } }>(
        port, 'application.exportCardBundle', { cardId: imported.card.id },
      )).artifact.extensionPackages).toEqual([])
      const packages = await callRpc<{ items: Array<{ packageId: string; modules: Array<{ desired: { enabled: boolean } }> }> }>(port, 'extensions.listPackages', {})
      expect(packages.items.find(item => item.packageId === archive.packageId)?.modules.every(module => !module.desired.enabled)).toBe(true)
    })
  })

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
        transformRules: [{ id: 'hide-think' }],
        textExtractors: [{ id: 'world-state' }],
      })

      await expect(callRpc(port, 'extensions.importPackageResources', {
        packageId: 'example.package-resources', target: { kind: 'card', cardId: 'not-a-global-install' },
      })).rejects.toThrow('targets are not exposed')
      const imported = await callRpc<{
        installationId: string
        promptResources: Array<{ contributionId: string; resourceId: string }>
        agentTools: Array<{ toolId: string }>
        transformRules: Array<{ contributionId: string; ruleId: string }>
        textExtractors: Array<{ contributionId: string; extractorId: string }>
      }>(port, 'extensions.importPackageResources', { packageId: 'example.package-resources' })
      expect(imported.promptResources).toHaveLength(2)
      await expect(callRpc(port, 'extensions.removePackageResources', {
        packageId: 'example.package-resources', target: { kind: 'card', cardId: 'not-a-global-install' },
      })).rejects.toThrow('targets are not exposed')
      expect(imported.agentTools).toEqual([
        { contributionId: 'example.package-resources/echo', toolId: 'example.package-resources/echo' },
        { contributionId: 'example.package-resources/content_echo', toolId: 'example.package-resources/content_echo' },
      ])
      expect(imported.transformRules).toEqual([{ contributionId: 'hide-think', ruleId: expect.any(String) }])
      expect(imported.textExtractors).toEqual([{ contributionId: 'world-state', extractorId: expect.any(String) }])
      await expect(callRpc(port, 'application.listTextTransformRules', {})).resolves.toMatchObject({
        rules: [expect.objectContaining({
          id: imported.transformRules[0]!.ruleId,
          owner: { kind: 'extension', packageId: 'example.package-resources' },
          origin: { kind: 'extension-package', packageId: 'example.package-resources', packageVersion: '1.0.0', contributionId: 'hide-think', installationId: imported.installationId },
        })],
      })
      await expect(callRpc(port, 'application.listTextExtractors', {})).resolves.toMatchObject({
        extractors: [expect.objectContaining({
          id: imported.textExtractors[0]!.extractorId,
          owner: { kind: 'extension', packageId: 'example.package-resources' },
          origin: { kind: 'extension-package', packageId: 'example.package-resources', packageVersion: '1.0.0', contributionId: 'world-state', installationId: imported.installationId },
        })],
      })

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
      const profile = await callRpc<{ agentPreset: { id: string } }>(port, 'application.updateAgentPreset', {
        name: 'Extension Package Resource Test Agent',
        agentPresetId: preset.id, expectedVersion: (await callRpc<{ resource: { version: number } }>(port, 'application.getPromptResource', { resourceId: preset.id })).resource.version,
        model: { providerProfileId: provider.providerProfile.id, modelId: officialFakeModelId },
      })
      const session = await callRpc<{ session: { id: string } }>(port, 'application.createAgentSession', {
        agentPresetId: profile.agentPreset.id,
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
      await callRpc(port, 'extensions.disableModule', { packageId: 'example.package-resources', moduleId: 'server' })
      await callRpc(port, 'extensions.enableModule', { packageId: 'example.package-resources', moduleId: 'server' })
      const importedAgain = await callRpc<typeof imported>(port, 'extensions.importPackageResources', { packageId: 'example.package-resources' })
      expect(importedAgain.promptResources).toEqual(imported.promptResources)
    })
  })

  it('removes owned resources while retaining external Preset, Tool, Card and Timeline references', async () => {
    await withStudioServer(async (port, root) => {
      const sourceDirectory = await writeCapabilityPackage(root)
      await callRpc(port, 'extensions.installPackage', { sourceDirectory })
      const imported = await callRpc<{
        promptResources: Array<{ contributionId: string; resourceId: string }>
      }>(port, 'extensions.importPackageResources', { packageId: 'example.package-resources' })
      const localPreset = await callRpc<{ resource: { id: string } }>(port, 'application.createPromptResource', {
        resourceKind: 'preset',
        name: 'Local Preset',
      })
      const settingId = imported.promptResources.find(resource => resource.contributionId === 'setting')!.resourceId
      const packagePresetId = imported.promptResources.find(resource => resource.contributionId === 'preset')!.resourceId
      const manualSource = { kind: 'manual', id: 'global' }
      const localSource = { kind: 'preset', id: localPreset.resource.id }
      for (const source of [manualSource, localSource]) {
        await callRpc(port, 'application.replaceSettingMounts', { source, settingResourceIds: [settingId] })
      }
      const manualMounts = await callRpc(port, 'application.listSettingMounts', { source: manualSource })
      const localMounts = await callRpc(port, 'application.listSettingMounts', { source: localSource })
      await callRpc(port, 'application.replacePresetToolMounts', {
        presetId: localPreset.resource.id,
        mounts: [{
          toolId: 'example.package-resources/content_echo',
          orderIndex: 0,
          defaultEnabled: true,
          content: { targetAnchorId: '@chat.tools', localDepth: 0 },
        }],
      })
      const localToolMounts = await callRpc(port, 'application.listPresetToolMounts', { presetId: localPreset.resource.id })
      const provider = await callRpc<{ providerProfile: { id: string } }>(port, 'application.createProviderProfile', {
        providerExtensionId: 'official.fake', displayName: 'Test Provider', config: {},
        enabledModelIds: [officialFakeModelId],
      })
      const profile = await callRpc<{ agentPreset: { id: string } }>(port, 'application.updateAgentPreset', {
        name: 'External Profile', agentPresetId: packagePresetId, expectedVersion: (await callRpc<{ resource: { version: number } }>(port, 'application.getPromptResource', { resourceId: packagePresetId })).resource.version,
        model: { providerProfileId: provider.providerProfile.id, modelId: officialFakeModelId },
      })
      const profileBefore = await callRpc(port, 'application.getAgentPreset', { agentPresetId: profile.agentPreset.id })
      const session = await callRpc<{ session: { id: string } }>(port, 'application.createAgentSession', { agentPresetId: profile.agentPreset.id })
      const card = await callRpc<{ card: { id: string } }>(port, 'application.createCard', { name: 'External Card' })
      await callRpc(port, 'application.updateCardPromptResources', {
        cardId: card.card.id, promptResourceIds: [settingId, packagePresetId],
      })
      const timeline = await callRpc<{ timeline: { id: string } }>(port, 'application.createNarrativeTimeline', { cardId: card.card.id })
      const cardBefore = await callRpc(port, 'application.getCard', { cardId: card.card.id })
      const timelineBefore = await callRpc(port, 'application.getNarrativeTimeline', { timelineId: timeline.timeline.id })
      expect(cardBefore).toMatchObject({ card: { promptResourceIds: [settingId, packagePresetId] } })
      expect(timelineBefore).toMatchObject({ timeline: { promptResourceIds: [settingId, packagePresetId] } })
      expect(profileBefore).toMatchObject({
        agentPreset: { id: packagePresetId },
      })

      const removed = await callRpc<{
        promptResourceIds: string[]
        agentToolIds: string[]
        textTransformRuleIds: string[]
        textExtractorIds: string[]
        detachedReferences: { presetToolMounts: number }
      }>(port, 'extensions.removePackageResources', { packageId: 'example.package-resources' })
      expect(removed.promptResourceIds).toHaveLength(2)
      expect(removed.agentToolIds).toEqual([
        'example.package-resources/content_echo',
        'example.package-resources/echo',
      ])
      expect(removed.textTransformRuleIds).toHaveLength(1)
      expect(removed.textExtractorIds).toHaveLength(1)
      expect(removed.detachedReferences).toEqual({ cards: 0, timelines: 0, presetToolMounts: 0 })
      await expect(callRpc(port, 'application.getAgentPreset', { agentPresetId: profile.agentPreset.id })).rejects.toThrow('Prompt resource not found')
      await expect(callRpc(port, 'application.getCard', { cardId: card.card.id })).resolves.toEqual(cardBefore)
      await expect(callRpc(port, 'application.getNarrativeTimeline', { timelineId: timeline.timeline.id })).resolves.toEqual(timelineBefore)
      for (const method of ['application.previewAgentTurn', 'application.invokeAgentTurn']) {
        await expect(callRpc(port, method, { agentSessionId: session.session.id, input: 'Continue.' }))
          .rejects.toThrow('Prompt resource not found')
      }

      const resources = await callRpc<{ resources: Array<{ origin?: { packageId?: string } }> }>(port, 'application.listPromptResources', {})
      expect(resources.resources.some(resource => resource.origin?.packageId === 'example.package-resources')).toBe(false)
      const tools = await callRpc<{ tools: Array<{ id: string }> }>(port, 'application.listAgentTools', {})
      expect(tools.tools.some(tool => tool.id.startsWith('example.package-resources/'))).toBe(false)
      await expect(callRpc(port, 'application.listTextTransformRules', {})).resolves.toEqual({ rules: [] })
      await expect(callRpc(port, 'application.listTextExtractors', {})).resolves.toEqual({ extractors: [] })
      await expect(callRpc<{ mounts: Array<{ toolId: string }> }>(port, 'application.listPresetToolMounts', {
        presetId: localPreset.resource.id,
      })).resolves.toEqual(localToolMounts)
      await expect(callRpc(port, 'application.listPresetToolMounts', { presetId: packagePresetId })).resolves.toEqual({ mounts: [] })
      await expect(callRpc(port, 'application.listSettingMounts', { source: manualSource })).resolves.toEqual(manualMounts)
      await expect(callRpc(port, 'application.listSettingMounts', { source: localSource })).resolves.toEqual(localMounts)
      const remainingMounts = await callRpc<{ mounts: Array<{ source: { kind: string; id: string } }> }>(
        port, 'application.listSettingMounts', {},
      )
      expect(remainingMounts.mounts.filter(mount =>
        mount.source.kind === 'preset' && mount.source.id === packagePresetId)).toEqual([])

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

  it('requires an explicit version-checked update before replacing Package resources', async () => {
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
      const { installations } = await callRpc<{ installations: Array<{ packageId: string; version: number }> }>(
        port, 'application.listExtensionInstallations', {},
      )
      const installation = installations.find(item => item.packageId === 'example.package-versioned-resources')!
      const update = {
        packageId: installation.packageId, packageVersion: '2.0.0',
        expectedInstallationVersion: installation.version,
      }
      await expect(callRpc(port, 'extensions.updatePackageResources', { ...update, packageVersion: '1.0.0' }))
        .rejects.toThrow('review the update again')
      await expect(callRpc(port, 'extensions.updatePackageResources', { ...update, expectedInstallationVersion: 0 }))
        .rejects.toThrow('positive integer')
      await expect(callRpc(port, 'extensions.updatePackageResources', update))
        .resolves.toMatchObject({ version: '2.0.0', promptResources: [{ contributionId: 'new-setting' }] })
      const { resources } = await callRpc<{ resources: Array<{ origin?: { packageId: string; contributionId: string } }> }>(
        port, 'application.listPromptResources', {},
      )
      expect(resources.filter(resource => resource.origin?.packageId === update.packageId).map(resource => resource.origin?.contributionId))
        .toEqual(['new-setting'])
      await expect(callRpc(port, 'extensions.updatePackageResources', update)).rejects.toThrow('changed before update')
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
      transformRules: [{ id: 'hide-think', source: './resources/hide-think.json' }],
      textExtractors: [{ id: 'world-state', source: './resources/world-state.json' }],
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
  await writeFile(join(directory, 'resources/hide-think.json'), JSON.stringify({
    name: 'Hide Think', enabled: true, orderIndex: 0,
    matcher: { kind: 'regex', pattern: '<think>([\\s\\S]*?)</think>', flags: 'g' },
    effect: { kind: 'promote-reasoning', contentGroup: 1, visibility: 'collapsed', replay: 'omit' },
    targets: ['agent-session'], phases: ['classify'],
  }))
  await writeFile(join(directory, 'resources/world-state.json'), JSON.stringify({
    name: 'World State', enabled: true, orderIndex: 0, targets: ['narrative'],
    matcher: { kind: 'regex', pattern: '<WorldState>([\\s\\S]*?)</WorldState>', flags: 'g', contentGroup: 1 },
    strategy: 'latest-valid', parser: 'key-value-lines',
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
