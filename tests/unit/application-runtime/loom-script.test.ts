import { createApplicationRuntime } from '@loom-studio/application-runtime'
import { createBlobStore } from '@loom-studio/asset-store'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseLoomScriptSource, serializeLoomScriptMetadata } from '../../../packages/application-runtime/src/scripts/loom-script-codec.js'
import { snapshotLoomScriptMounts } from '../../../packages/application-runtime/src/scripts/loom-script-resolution.js'
import { initializeLoomScriptAdoptions } from '../../../packages/application-runtime/src/runtime/loom-scripts-runtime.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Loom Script codec and store', () => {
  it('resolves precedence before reading invalid obsolete settings and can browse disabled mounts', async () => {
    const fixture = await createFixture()
    const runtime = createApplicationRuntime(fixture)
    try {
      const code = hostSource('client').replace('// ==/LoomScript==',
        '// @setting {"key":"obsolete","label":"旧配置","type":"string","default":"old"}\n// ==/LoomScript==')
      const { script } = await runtime.importLoomScript({ owner: { kind: 'user' }, fileName: 'obsolete.loom.js', source: code })
      const { mount: global } = await runtime.createLoomScriptMount({ target: { kind: 'user' }, scriptDocumentId: script.id, orderIndex: 0 })
      await runtime.updateLoomScriptMount({ mountId: global.id, expectedVersion: global.version, enabled: false,
        orderIndex: 0, grantedCapabilities: [], settings: { obsolete: 'saved' } })
      const { mount: role } = await runtime.createLoomScriptMount({ target: { kind: 'card', cardId: 'role' }, scriptDocumentId: script.id, orderIndex: 0 })
      await runtime.updateLoomScript({ scriptDocumentId: script.id, expectedVersion: script.version, fileName: 'obsolete.loom.js', source: hostSource('client') })
      expect((await runtime.resolveLoomScriptRendererMounts({ cardId: 'role' })).mounts).toEqual([
        expect.objectContaining({ mountId: role.id, enabled: false, settings: {} }),
      ])
      expect((await runtime.resolveLoomScriptRendererMounts()).mounts).toEqual([
        expect.objectContaining({ mountId: global.id, enabled: false, settings: {} }),
      ])
      expect((await runtime.getLoomScriptSettings({ mountId: global.id })).validationError).toContain('obsolete')
    } finally { await fixture.dataEngine.close() }
  })

  it('preserves migrated preset inheritance on settings saves and clears it on explicit enabled changes', async () => {
    const fixture = await createFixture()
    const runtime = createApplicationRuntime(fixture)
    try {
      const { script } = await runtime.importLoomScript({ owner: { kind: 'user' }, fileName: 'legacy.loom.js', source: source() })
      const { mount } = await runtime.createLoomScriptMount({ target: { kind: 'user' }, scriptDocumentId: script.id, orderIndex: 0,
        origin: { legacyPresetInheritance: true, legacyRuleId: 'old-rule' } })
      const saved = (await runtime.updateLoomScriptMount({ mountId: mount.id, expectedVersion: mount.version,
        enabled: false, orderIndex: 0, grantedCapabilities: [], settings: {} })).mount
      expect(saved.origin).toEqual(mount.origin)
      const enabled = (await runtime.updateLoomScriptMount({ mountId: mount.id, expectedVersion: saved.version,
        enabled: true, orderIndex: 0, grantedCapabilities: ['state.read'] })).mount
      expect(enabled.origin).toEqual({ legacyRuleId: 'old-rule' })
      const disabled = (await runtime.updateLoomScriptMount({ mountId: mount.id, expectedVersion: enabled.version,
        enabled: false, orderIndex: 0, grantedCapabilities: ['state.read'] })).mount
      expect(disabled.origin).toEqual({ legacyRuleId: 'old-rule' })
    } finally { await fixture.dataEngine.close() }
  })

  it('stores configuration separately, captures it only on activation/refresh, and lets explicit role OFF mask global', async () => {
    const fixture = await createFixture()
    const runtime = createApplicationRuntime(fixture)
    try {
      const configuredSource = hostSource('client').replace('// ==/LoomScript==',
        '// @setting {"key":"caption","label":"显示名称","type":"string","default":"旁白"}\n// @setting {"key":"size","label":"字号","type":"number","default":12,"min":8,"max":40}\n// ==/LoomScript==')
      const { script } = await runtime.importLoomScript({ owner: { kind: 'user' }, fileName: 'settings.loom.js', source: configuredSource })
      const { mount: global } = await runtime.createLoomScriptMount({ target: { kind: 'user' }, scriptDocumentId: script.id, orderIndex: 0 })
      const enabledGlobal = (await runtime.updateLoomScriptMount({ mountId: global.id, expectedVersion: global.version,
        enabled: true, orderIndex: 0, grantedCapabilities: ['state.read', 'runtime.client'], settings: { caption: '记录员' } })).mount
      const globalBefore = (await runtime.resolveLoomScriptRendererMounts()).mounts[0]!
      expect(globalBefore.settings).toEqual({ caption: '记录员', size: 12 })
      const saved = (await runtime.updateLoomScriptMount({ mountId: global.id, expectedVersion: enabledGlobal.version,
        enabled: true, orderIndex: 0, grantedCapabilities: enabledGlobal.grantedCapabilities, settings: { caption: '作者' } })).mount
      const globalAfter = (await runtime.resolveLoomScriptRendererMounts()).mounts[0]!
      expect(globalAfter.mountVersion).toBe(globalBefore.mountVersion)
      expect(globalAfter.settings).toEqual(globalBefore.settings)
      expect((await runtime.exportLoomScript({ scriptDocumentId: script.id })).artifact.source).toBe(configuredSource)
      expect((await runtime.getLoomScript({ scriptDocumentId: script.id })).script.version).toBe(script.version)
      await expect(runtime.updateLoomScriptMount({ mountId: global.id, expectedVersion: saved.version, enabled: true,
        orderIndex: 0, grantedCapabilities: saved.grantedCapabilities, settings: { size: 100 } })).rejects.toThrow()

      const { mount: role } = await runtime.createLoomScriptMount({ target: { kind: 'card', cardId: 'role' }, scriptDocumentId: script.id, orderIndex: 0 })
      expect((await runtime.resolveLoomScriptRendererMounts({ cardId: 'role' })).mounts).toEqual([
        expect.objectContaining({ mountId: role.id, enabled: false }),
      ])
      const roleEnabled = (await runtime.updateLoomScriptMount({ mountId: role.id, expectedVersion: role.version,
        enabled: true, orderIndex: 0, grantedCapabilities: ['state.read', 'runtime.client'], settings: { size: 18 } })).mount
      expect((await runtime.resolveLoomScriptRendererMounts({ cardId: 'role' })).mounts).toEqual([
        expect.objectContaining({ mountId: role.id, settings: { caption: '记录员', size: 18 } }),
      ])
      await runtime.refreshLoomScriptMount({ mountId: global.id, expectedVersion: saved.version })
      expect((await runtime.resolveLoomScriptRendererMounts({ cardId: 'role' })).mounts[0]?.settings).toEqual({ caption: '记录员', size: 18 })
      const roleRefreshed = (await runtime.refreshLoomScriptMount({ mountId: role.id, expectedVersion: roleEnabled.version })).mount
      expect((await runtime.resolveLoomScriptRendererMounts({ cardId: 'role' })).mounts[0]?.settings).toEqual({ caption: '作者', size: 18 })
      expect((await runtime.resolveLoomScriptRendererMounts({ cardId: 'different-role' })).mounts[0]?.mountId).toBe(global.id)
      expect(await runtime.getLoomScriptSettings({ mountId: role.id })).toMatchObject({
        saved: { size: 18 }, adopted: { caption: '作者', size: 18 }, effective: { caption: '作者', size: 18 },
      })
      await runtime.updateLoomScript({ scriptDocumentId: script.id, expectedVersion: script.version, fileName: 'settings.loom.js',
        source: configuredSource.split('\n').filter(line => !line.includes('"key":"size"')).join('\n') })
      const obsolete = await runtime.getLoomScriptSettings({ mountId: role.id })
      expect(obsolete.validationError).toContain('size')
      expect(obsolete.saved).toEqual({ size: 18 })
      expect(obsolete.effective).toBeUndefined()
      const cleared = (await runtime.updateLoomScriptMount({ mountId: role.id, expectedVersion: roleRefreshed.version,
        enabled: true, orderIndex: 0, grantedCapabilities: roleRefreshed.grantedCapabilities, settings: {} })).mount
      expect((await runtime.getLoomScriptSettings({ mountId: role.id })).validationError).toBeUndefined()
      await runtime.deleteLoomScriptMount({ mountId: role.id, expectedVersion: cleared.version })
      expect((await runtime.resolveLoomScriptRendererMounts({ cardId: 'role' })).mounts[0]?.mountId).toBe(global.id)

    } finally { await fixture.dataEngine.close() }
  })

  it('freezes existing enabled mounts once on startup before source edits', async () => {
    const fixture = await createFixture()
    const runtime = createApplicationRuntime(fixture)
    try {
      const { script } = await runtime.importLoomScript({ owner: { kind: 'user' }, fileName: 'legacy.loom.js', source: source() })
      const { mount } = await runtime.createLoomScriptMount({ target: { kind: 'user' }, scriptDocumentId: script.id, orderIndex: 0 })
      const { id, version, ...content } = mount
      await fixture.documents.write({ id, type: 'airp.loomScriptMount', expectedVersion: version,
        content: { ...content, enabled: true, grantedCapabilities: ['state.read'] } })
      await initializeLoomScriptAdoptions(fixture)
      const adopted = (await runtime.listLoomScriptMounts()).mounts[0]!
      expect(adopted.adoptedDocumentVersion).toBe(script.version)
      await initializeLoomScriptAdoptions(fixture)
      expect((await runtime.listLoomScriptMounts()).mounts[0]).toEqual(adopted)
      await runtime.updateLoomScript({ scriptDocumentId: script.id, expectedVersion: script.version, fileName: 'legacy.loom.js', source: hostSource('client') })
      expect((await runtime.resolveLoomScriptRendererMounts()).mounts[0]?.script.runtime).toBe('client-sandbox')
    } finally { await fixture.dataEngine.close() }
  })

  it.each(['client', 'client-worker', 'server'] as const)('imports %s scripts without Renderers and requires trust before adopting their saved version', async environment => {
    const fixture = await createFixture()
    const runtime = createApplicationRuntime(fixture)
    try {
      const imported = await runtime.importLoomScript({ owner: { kind: 'user' }, fileName: 'background.loom.js', source: hostSource(environment) })
      expect(imported.script).toMatchObject({ runtime: environment, contributions: [], requestedCapabilities: ['state.read', `runtime.${environment}`] })
      const saved = await runtime.updateLoomScript({
        scriptDocumentId: imported.script.id, expectedVersion: imported.script.version,
        fileName: 'background.loom.js', source: hostSource(environment, 2),
      })
      expect((await runtime.listLoomScriptMounts()).mounts).toEqual([])
      expect((await runtime.resolveLoomScriptRendererMounts()).mounts).toEqual([])

      const { mount } = await runtime.createLoomScriptMount({ target: { kind: 'user' }, scriptDocumentId: imported.script.id, orderIndex: 0 })
      expect(mount).toMatchObject({ enabled: false, grantedCapabilities: [] })
      expect(mount.adoptedDocumentVersion).toBeUndefined()
      const update = { mountId: mount.id, expectedVersion: mount.version, enabled: true, orderIndex: 0 }
      await expect(runtime.updateLoomScriptMount({ ...update, grantedCapabilities: ['state.read'] })).rejects.toThrow('Explicit trust is required')
      expect((await runtime.listLoomScriptMounts()).mounts).toEqual([mount])
      const enabled = await runtime.updateLoomScriptMount({ ...update, grantedCapabilities: ['state.read', `runtime.${environment}`] })
      expect(enabled.mount.adoptedDocumentVersion).toBe(saved.script.version)
      expect((await runtime.resolveLoomScriptRendererMounts()).mounts).toEqual([expect.objectContaining({
        mountId: mount.id, source: hostSource(environment, 2),
        script: expect.objectContaining({ runtime: environment, version: saved.script.version, contributions: [] }),
      })])
    } finally {
      await fixture.dataEngine.close()
    }
  })

  it('keeps the adopted source and runtime after saving and adopts the authorized replacement only on refresh', async () => {
    const fixture = await createFixture()
    const runtime = createApplicationRuntime(fixture)
    try {
      const imported = await runtime.importLoomScript({ owner: { kind: 'user' }, fileName: 'background.loom.js', source: hostSource('server') })
      const { mount } = await runtime.createLoomScriptMount({ target: { kind: 'user' }, scriptDocumentId: imported.script.id, orderIndex: 0 })
      const enabled = await runtime.updateLoomScriptMount({
        mountId: mount.id, expectedVersion: mount.version, enabled: true, orderIndex: 0,
        grantedCapabilities: ['state.read', 'runtime.server'],
      })
      const saved = await runtime.updateLoomScript({
        scriptDocumentId: imported.script.id, expectedVersion: imported.script.version,
        fileName: 'background.loom.js', source: hostSource('client', 2),
      })
      expect((await runtime.listLoomScriptMounts()).mounts).toEqual([enabled.mount])
      expect((await runtime.resolveLoomScriptRendererMounts()).mounts).toEqual([expect.objectContaining({
        source: hostSource('server'), script: expect.objectContaining({ runtime: 'server', version: imported.script.version }),
      })])
      await expect(runtime.refreshLoomScriptMount({ mountId: mount.id, expectedVersion: enabled.mount.version }))
        .rejects.toThrow('Explicit trust is required')
      expect((await runtime.listLoomScriptMounts()).mounts).toEqual([enabled.mount])
      const authorized = await runtime.updateLoomScriptMount({
        mountId: mount.id, expectedVersion: enabled.mount.version, enabled: true, orderIndex: 0,
        grantedCapabilities: ['state.read', 'runtime.server', 'runtime.client'],
      })
      const refreshed = await runtime.refreshLoomScriptMount({ mountId: mount.id, expectedVersion: authorized.mount.version })
      expect(refreshed.mount.adoptedDocumentVersion).toBe(saved.script.version)
      expect((await runtime.resolveLoomScriptRendererMounts()).mounts).toEqual([expect.objectContaining({
        source: hostSource('client', 2), script: expect.objectContaining({ runtime: 'client', version: saved.script.version }),
      })])
    } finally {
      await fixture.dataEngine.close()
    }
  })

  it('resolves the same retained mount after its source is restored', async () => {
    const fixture = await createFixture()
    const runtime = createApplicationRuntime(fixture)
    try {
      const { script } = await runtime.importLoomScript({ owner: { kind: 'user' }, fileName: 'restored.loom.js', source: source() })
      const { mount } = await runtime.createLoomScriptMount({ target: { kind: 'user' }, scriptDocumentId: script.id, orderIndex: 0 })
      const enabled = await runtime.updateLoomScriptMount({
        mountId: mount.id, expectedVersion: mount.version, enabled: true, orderIndex: 0, grantedCapabilities: ['state.read'],
      })
      const deleted = await fixture.documents.delete({ id: script.id, expectedVersion: script.version })
      expect((await runtime.resolveLoomScriptRendererMounts()).unavailableMounts).toEqual([
        expect.objectContaining({ mountId: mount.id, reason: 'script-missing', severity: 'warning' }),
      ])
      await fixture.documents.revertChangeset({ changesetId: deleted.changesetId, actor: { kind: 'system', id: 'test' } })
      const restored = await runtime.resolveLoomScriptRendererMounts()
      expect(restored.unavailableMounts).toEqual([])
      expect(restored.mounts).toEqual([expect.objectContaining({
        mountId: mount.id, enabled: true, grantedCapabilities: ['state.read'],
        script: expect.objectContaining({ id: script.id }),
      })])
      expect((await runtime.listLoomScriptMounts()).mounts).toEqual([enabled.mount])
    } finally {
      await fixture.dataEngine.close()
    }
  })

  it.each(['keep-play-data', 'delete-play-data', 'uninstall'] as const)('retains unavailable references without blocking healthy scripts after %s', async mode => {
    const fixture = await createFixture()
    const runtime = createApplicationRuntime(fixture)
    try {
      const { card } = await runtime.createCard({ name: 'Removed owner' })
      const other = (await runtime.createCard({ name: 'Healthy owner' })).card
      const { timeline } = await runtime.createNarrativeTimeline({ cardId: other.id })
      const installation = await runtime.importExtensionPackageResources({
        packageId: 'example.scripts', packageVersion: '1.0.0', target: { kind: 'card', cardId: card.id },
        promptResources: [], agentTools: [], transformRules: [], textExtractors: [],
      })
      const imported = await runtime.importLoomScript({
        owner: { kind: 'extension', packageId: 'example.scripts', installationId: installation.installationId },
        fileName: 'private.loom.js', source: source(),
      })
      const healthy = await runtime.importLoomScript({ owner: { kind: 'user' }, fileName: 'healthy.loom.js', source: source() })
      const enabledMounts = []
      for (const script of [imported.script, healthy.script]) {
        const { mount } = await runtime.createLoomScriptMount({ target: { kind: 'user' }, scriptDocumentId: script.id, orderIndex: enabledMounts.length })
        const enabled = await runtime.updateLoomScriptMount({
          mountId: mount.id, expectedVersion: mount.version, enabled: true, orderIndex: mount.orderIndex, grantedCapabilities: ['state.read'],
        })
        enabledMounts.push(enabled.mount)
      }
      if (mode === 'uninstall') {
        await runtime.removeExtensionPackageResources({
          packageId: 'example.scripts', target: { kind: 'card', cardId: card.id },
          uninstall: true, expectedInstallationVersion: (await fixture.documents.get(installation.installationId))!.version,
        })
      } else {
        await runtime.deleteCard({ cardId: card.id, includePlayData: mode === 'delete-play-data', includePromptResources: true })
      }
      for (const context of [undefined, { timelineId: timeline.id }]) {
        const result = await runtime.resolveLoomScriptRendererMounts(context)
        expect(result.mounts.map(mount => mount.script.id)).toEqual([healthy.script.id])
        expect(result.unavailableMounts).toEqual([expect.objectContaining({
          mountId: enabledMounts[0]!.id, scriptDocumentId: imported.script.id,
          enabled: true, available: false, severity: 'warning',
          reason: 'installation-missing',
        })])
      }
      expect((await runtime.listLoomScriptMounts({ target: { kind: 'user' } })).mounts).toEqual(enabledMounts)
      const failure = new Error('Document storage unavailable')
      const read = vi.spyOn(fixture.documents, 'get').mockRejectedValueOnce(failure)
      try {
        await expect(runtime.resolveLoomScriptRendererMounts()).rejects.toBe(failure)
      } finally {
        read.mockRestore()
      }
    } finally {
      await fixture.dataEngine.close()
    }
  })

  it('parses multiple contributions and serializes canonical Metadata', () => {
    const metadata = parseLoomScriptSource(source())
    expect(metadata.contributions.map(item => item.kind === 'renderer' ? item.renderer.id : item.id)).toEqual(['status-panel', 'status-tail'])
    expect(parseLoomScriptSource(`${serializeLoomScriptMetadata(metadata)}\nexport const renderers = {}`)).toEqual(metadata)
  })

  it('keeps installed scripts sandboxed and resolves private sources only for their actual Card', async () => {
    const fixture = await createFixture()
    const runtime = createApplicationRuntime(fixture)
    try {
      const a = (await runtime.createCard({ name: 'A' })).card
      const b = (await runtime.createCard({ name: 'B' })).card
      const timelineA = (await runtime.createNarrativeTimeline({ cardId: a.id })).timeline
      const timelineB = (await runtime.createNarrativeTimeline({ cardId: b.id })).timeline
      const installed = await runtime.importExtensionPackageResources({
        packageId: 'example.scripts', packageVersion: '1.0.0', target: { kind: 'card', cardId: a.id },
        promptResources: [], agentTools: [], transformRules: [], textExtractors: [],
      })
      const owner = { kind: 'extension' as const, packageId: 'example.scripts', installationId: installed.installationId }
      await expect(runtime.importLoomScript({
        owner: { ...owner, packageId: 'other.package' }, fileName: 'alice.loom.js', source: source(),
      })).rejects.toThrow('owner does not match')
      expect((await runtime.listLoomScripts()).scripts).toEqual([])
      const { script } = await runtime.importLoomScript({ owner, fileName: 'alice.loom.js', source: source() })
      expect(script.runtime).toBe('client-sandbox')
      const { mount } = await runtime.createLoomScriptMount({ target: { kind: 'user' }, scriptDocumentId: script.id, orderIndex: 0 })
      await runtime.updateLoomScriptMount({
        mountId: mount.id, expectedVersion: mount.version, enabled: true, orderIndex: 0, grantedCapabilities: ['state.read'],
      })
      expect((await runtime.resolveLoomScriptRendererMounts({ timelineId: timelineA.id })).mounts).toHaveLength(1)
      expect((await runtime.resolveLoomScriptRendererMounts({ timelineId: timelineB.id })).mounts).toEqual([])
      expect((await runtime.resolveLoomScriptRendererMounts()).mounts).toEqual([])
    } finally {
      await fixture.dataEngine.close()
    }
  })

  it.each([
    ['missing field', source().replace('// @name         Alice UI\n', ''), 'Missing Loom Script Metadata field: @name'],
    ['duplicate field', source().replace('// @name         Alice UI', '// @name         Alice UI\n// @name         Again'), 'Duplicate Loom Script Metadata field: @name'],
    ['unknown field', source().replace('// @name         Alice UI', '// @name         Alice UI\n// @kind         renderer'), 'Unknown Loom Script Metadata field: @kind'],
    ['duplicate contribution', source().replace('"id":"status-tail"', '"id":"status-panel"'), 'Duplicate Loom Script contribution id'],
    ['invalid input', source().replace('match:alice.status', 'network:anywhere'), 'Unsupported Loom Script contribution input'],
  ])('rejects %s', (_label, input, message) => {
    expect(() => parseLoomScriptSource(input)).toThrow(message)
  })

  it('atomically stores source bytes, exports byte-exact text, and keeps Mount grants independent', async () => {
    const fixture = await createFixture()
    const runtime = createApplicationRuntime(fixture) as any
    const imported = await runtime.importLoomScript({
      owner: { kind: 'card', cardId: 'card-1' },
      fileName: 'alice.loom.js',
      source: source('\r\n'),
    })
    const exported = await runtime.exportLoomScript({ scriptDocumentId: imported.script.id })
    expect(exported.artifact.source).toBe(source('\r\n'))
    expect(imported.script.metadataId).toBe('alice.presentation')
    expect(imported.script.id).not.toBe(imported.script.metadataId)

    const createdMount = await runtime.createLoomScriptMount({
      target: { kind: 'card', cardId: 'card-1' },
      scriptDocumentId: imported.script.id,
      orderIndex: 4,
    })
    expect(createdMount.mount).toMatchObject({ enabled: false, grantedCapabilities: [] })
    const updatedMount = await runtime.updateLoomScriptMount({
      mountId: createdMount.mount.id,
      expectedVersion: createdMount.mount.version,
      enabled: true,
      orderIndex: 4,
      grantedCapabilities: ['state.read'],
    })
    expect(updatedMount.mount).toMatchObject({ enabled: true, grantedCapabilities: ['state.read'] })
  })

  it('rejects invalid Metadata without a partial Document and reimports duplicate Metadata as independent copies', async () => {
    const fixture = await createFixture()
    const runtime = createApplicationRuntime(fixture) as any
    await expect(runtime.importLoomScript({
      owner: { kind: 'card', cardId: 'card-1' },
      fileName: 'broken.loom.js',
      source: 'export const renderers = {}',
    })).rejects.toThrow('Metadata must start')
    await expect(fixture.documents.list({ type: 'airp.loomScript' })).resolves.toMatchObject({ items: [] })

    const original = await runtime.importLoomScript({ owner: { kind: 'card', cardId: 'card-1' }, fileName: 'alice.loom.js', source: source() })
    const sameBytes = await runtime.importLoomScript({ owner: { kind: 'card', cardId: 'card-1' }, fileName: 'alice.loom.js', source: source() })
    const changedSource = source().replace('export const value = 1', 'export const value = 2')
    const changed = await runtime.importLoomScript({
      owner: { kind: 'card', cardId: 'card-1' },
      fileName: 'alice.loom.js',
      source: changedSource,
    })
    expect(new Set([original.script.id, sameBytes.script.id, changed.script.id]).size).toBe(3)
    expect((await runtime.listLoomScripts()).scripts).toHaveLength(3)
    expect((await runtime.exportLoomScript({ scriptDocumentId: original.script.id })).artifact.source).toBe(source())
    await runtime.updateLoomScript({
      scriptDocumentId: sameBytes.script.id, expectedVersion: sameBytes.script.version,
      fileName: 'alice.loom.js', source: changedSource,
    })
    expect((await runtime.exportLoomScript({ scriptDocumentId: sameBytes.script.id })).artifact.source).toBe(changedSource)
    expect((await runtime.exportLoomScript({ scriptDocumentId: original.script.id })).artifact.source).toBe(source())
  })

  it('uses current Card Script mounts in existing Timelines and does not revive removed mounts', async () => {
    const fixture = await createFixture()
    const runtime = createApplicationRuntime(fixture)
    const { card } = await runtime.createCard({ name: 'Script card' })
    const imported = await runtime.importLoomScript({
      owner: { kind: 'card', cardId: card.id },
      fileName: 'alice.loom.js',
      source: source(),
    })
    const createdMount = await runtime.createLoomScriptMount({
      target: { kind: 'card', cardId: card.id },
      scriptDocumentId: imported.script.id,
      orderIndex: 0,
    })
    const enabled = await runtime.updateLoomScriptMount({
      mountId: createdMount.mount.id,
      expectedVersion: createdMount.mount.version,
      enabled: true,
      orderIndex: 0,
      grantedCapabilities: ['state.read'],
    })
    const { timeline, branch } = await runtime.createNarrativeTimeline({ cardId: card.id })
    const context = (await fixture.documents.get(`timeline-runtime-context:${timeline.id}`))!
    assert.ok(context.content && typeof context.content === 'object' && !Array.isArray(context.content))
    await fixture.documents.write({
      id: context.id, type: context.type, expectedVersion: context.version,
      content: { ...context.content, loomScriptMounts: (await snapshotLoomScriptMounts(fixture, { kind: 'card', cardId: card.id })).snapshots },
    })
    const target = { scope: 'timeline' as const, timelineId: timeline.id, branchId: branch.id }
    const state = await runtime.getStateSnapshot({ target })
    const before = await runtime.resolveLoomScriptRendererMounts({ timelineId: timeline.id })
    expect(before.mounts[0]?.source).toContain('export const value = 1')

    const updated = await runtime.updateLoomScript({
      scriptDocumentId: imported.script.id,
      expectedVersion: imported.script.version,
      fileName: 'alice.loom.js',
      source: source().replace('export const value = 1', 'export const value = 2'),
    })

    const { mounts } = await runtime.resolveLoomScriptRendererMounts({ timelineId: timeline.id })
    expect(mounts).toHaveLength(1)
    expect(mounts[0]).toMatchObject({ enabled: true, grantedCapabilities: ['state.read'], script: { version: imported.script.version } })
    expect(mounts[0]?.source).toContain('export const value = 1')
    const refreshed = await runtime.refreshLoomScriptMount({ mountId: enabled.mount.id, expectedVersion: enabled.mount.version })
    const afterRefresh = await runtime.resolveLoomScriptRendererMounts({ timelineId: timeline.id })
    expect(afterRefresh.mounts[0]?.script.version).toBe(updated.script.version)
    expect(afterRefresh.mounts[0]?.source).toContain('export const value = 2')
    await fixture.documents.delete({ id: refreshed.mount.id, expectedVersion: refreshed.mount.version })
    expect((await runtime.resolveLoomScriptRendererMounts({ timelineId: timeline.id })).mounts).toEqual([])
    expect(await runtime.getStateSnapshot({ target })).toEqual(state)
    await fixture.dataEngine.close()
  })

  it('keeps package contributions independent despite duplicate Metadata and saves edits under the installation owner', async () => {
    const fixture = await createFixture()
    const runtime = createApplicationRuntime(fixture)
    try {
      const input = {
        packageId: 'example.scripts', packageVersion: '1.0.0',
        promptResources: [], agentTools: [], transformRules: [], textExtractors: [],
        loomScripts: ['first', 'second'].map(id => ({ contribution: { id, source: `./${id}.loom.js` }, source: source() })),
      }
      const imported = await runtime.importExtensionPackageResources(input)
      const first = (await runtime.getLoomScript({ scriptDocumentId: imported.loomScripts![0]!.scriptId })).script
      const second = (await runtime.getLoomScript({ scriptDocumentId: imported.loomScripts![1]!.scriptId })).script
      expect(first.id).not.toBe(second.id)
      const editedSource = source('\r\n').replace('value = 1', 'value = 2')
      const updated = await runtime.updateLoomScript({ scriptDocumentId: first.id, expectedVersion: first.version, fileName: first.source.fileName, source: editedSource })
      expect(updated.script.owner).toEqual({ kind: 'extension', packageId: input.packageId, installationId: imported.installationId })
      expect(updated.script.id).toBe(first.id)
      expect((await runtime.exportLoomScript({ scriptDocumentId: first.id })).artifact.source).toBe(editedSource)
      expect((await runtime.exportLoomScript({ scriptDocumentId: second.id })).artifact.source).toBe(source())
      await runtime.importExtensionPackageResources(input)
      expect((await runtime.exportLoomScript({ scriptDocumentId: first.id })).artifact.source).toBe(editedSource)
      expect((await runtime.listLoomScripts({ owner: { kind: 'user' } })).scripts).toEqual([])
    } finally {
      await fixture.dataEngine.close()
    }
  })
})

function hostSource(runtime: 'client' | 'client-worker' | 'server', version = 1): string {
  return source().split('\n')
    .filter(line => !line.startsWith('// @contribution'))
    .join('\n')
    .replace('// @runtime      client-sandbox', `// @runtime      ${runtime}`)
    .replace('export const value = 1', `export function activate(ctx) { return ${version}; }`)
}

function source(newline = '\n'): string {
  return [
    '// ==LoomScript==',
    '// @format       1',
    '// @id           alice.presentation',
    '// @name         Alice UI',
    '// @version      1.0.0',
    '// @runtime      client-sandbox',
    '// @capability   state.read',
    '// @contribution {"kind":"renderer","id":"status-panel","surface":"narrative.entry.inline","scope":"node","inputs":["match:alice.status"]}',
    '// @contribution {"kind":"renderer","id":"status-tail","surface":"narrative.timeline.tail","scope":"timeline","inputs":["artifact:alice.summary"]}',
    '// ==/LoomScript==',
    'export const value = 1',
    '',
  ].join(newline)
}

async function createFixture() {
  let sequence = 0
  const createId = (prefix: string) => `${prefix}-${++sequence}`
  const now = () => '2026-09-11T00:00:00.000Z'
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const rootDirectory = await mkdtemp(join(tmpdir(), 'loom-script-test-'))
  roots.push(rootDirectory)
  return {
    now,
    dataEngine: engine,
    documents: createSqliteDocumentStore({ engine }),
    promptResources: createPromptResourceStore({ engine, createId, now }),
    narratives: createNarrativeStore({ engine, createId, now }),
    blobs: createBlobStore({ engine, rootDirectory, createId, now }),
  }
}
