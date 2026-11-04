import { describe, expect, it, vi } from 'vitest'
import { toggleExtensionPackage } from '../../../apps/studio-client/src/features/extension-renderers/model/toggle-extension-package.js'
import type { ManagedExtensionModule } from '../../../apps/studio-client/src/entities/extension.js'

const modules = (enabled: boolean): ManagedExtensionModule[] => ['first', 'second'].map(moduleId => ({
  packageId: 'example', moduleId, runtimeKind: 'client', desired: { enabled },
  contributions: {},
}))

describe('toggleExtensionPackage', () => {
  it('submits one accepted batch with the selected Card target and existing grants', async () => {
    const target = { kind: 'card' as const, cardId: 'card-a' }
    const items = modules(false)
    items[0]!.desired.grants = { ui: ['ui.notify'] }
    const start = vi.fn(async () => ({ batchId: 'accepted' }))
    await expect(toggleExtensionPackage({ packageId: 'example', target, modules: items, enabled: true, start }))
      .resolves.toEqual({ batchId: 'accepted' })
    expect(start).toHaveBeenCalledExactlyOnceWith({ packageId: 'example', target, enabled: true,
      modules: [{ moduleId: 'first', grants: { ui: ['ui.notify'] } }, { moduleId: 'second', grants: undefined }] })
  })

  it('propagates rejection before acceptance without dispatching individual module calls', async () => {
    const start = vi.fn(async () => { throw new Error('package unavailable') })
    await expect(toggleExtensionPackage({ packageId: 'example', target: { kind: 'global' }, modules: modules(true), enabled: false, start }))
      .rejects.toThrow('package unavailable')
    expect(start).toHaveBeenCalledTimes(1)
  })
})
