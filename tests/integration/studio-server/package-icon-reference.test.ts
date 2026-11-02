import { describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { withStudioServer, callRpc } from './helpers.js'

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
function archive(id: string, icon?: Record<string, unknown>, dependencies?: unknown[]) {
  return Buffer.from(zipSync({
    'manifest.json': encode({ manifestVersion: 2, id, version: '1.0.0', displayName: id, engines: { studio: '*' }, dependencies,
      contributes: icon ? { promptResources: [{ id: 'preset', resourceKind: 'preset', source: 'preset.json' }] } : {} }),
    'pixel.png': Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')),
    ...(icon ? { 'preset.json': encode({ format: 'loom.promptResource', schemaVersion: 2, resourceKind: 'preset', metadata: { icon }, rootNode: { id: `${id}.root`, kind: 'module', label: id } }) } : {}),
  })).toString('base64')
}
describe('package icon references through the real Server', () => {
  it('registers asset-only providers and checks actual dependency files before resource installation', async () => {
    await withStudioServer(async port => {
      await callRpc(port, 'extensions.installPackageZip', { base64: archive('example.images') })
      const installations = await callRpc<{ installations: Array<{ packageId: string }> }>(port, 'application.listExtensionInstallations', {})
      expect(installations.installations.some(item => item.packageId === 'example.images')).toBe(true)
      const icon = { kind: 'package', packageId: 'example.images', path: 'pixel.png', scope: 'global' }
      await callRpc(port, 'extensions.installPackageZip', { base64: archive('example.viewer', icon, [{ id: 'example.images', version: '^1.0.0' }]) })
      const imported = await callRpc<{ promptResources: Array<{ resourceId: string }> }>(port, 'extensions.importPackageResources', { packageId: 'example.viewer' })
      const preset = await callRpc<{ resource: { metadata: { icon: { target: unknown } } } }>(port, 'application.getPromptResource', { resourceId: imported.promptResources[0]!.resourceId })
      expect(preset.resource.metadata.icon.target).toEqual({ kind: 'global' })
      await expect(callRpc(port, 'extensions.installPackageZip', { base64: archive('example.missing-image', { ...icon, path: 'missing.png' }, [{ id: 'example.images', version: '^1.0.0' }]) })).rejects.toThrow('resource import failed')
      const after = await callRpc<{ installations: Array<{ packageId: string }> }>(port, 'application.listExtensionInstallations', {})
      expect(after.installations.some(item => item.packageId === 'example.missing-image')).toBe(false)
    })
  }, 20_000)
})
