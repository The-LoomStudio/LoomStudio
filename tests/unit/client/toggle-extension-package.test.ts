import { describe, expect, it, vi } from 'vitest'
import { toggleExtensionPackage } from '../../../apps/studio-client/src/features/extension-renderers/model/toggle-extension-package.js'
import type { ManagedExtensionModule } from '../../../apps/studio-client/src/entities/extension.js'

const modules = (enabled: boolean): ManagedExtensionModule[] => ['first', 'second'].map(moduleId => ({
  packageId: 'example', moduleId, runtimeKind: 'client', desired: { enabled },
  contributions: {},
}))

describe('toggleExtensionPackage', () => {
  it('passes the selected Card target and existing grants to each module', async () => {
    const target = { kind: 'card' as const, cardId: 'card-a' }
    const items = modules(false)
    items[0]!.desired.grants = { ui: ['ui.notify'] }
    const enable = vi.fn(async () => undefined)
    const result = await toggleExtensionPackage({ packageId: 'example', target, modules: items, enabled: true, enable, disable: vi.fn() })
    expect(result).toEqual({ completed: ['first', 'second'], failed: [], untouched: [] })
    expect(enable).toHaveBeenNthCalledWith(1, 'example', 'first', { ui: ['ui.notify'] }, target)
    expect(enable).toHaveBeenNthCalledWith(2, 'example', 'second', undefined, target)
  })

  it('reports partial failure and continues without rollback', async () => {
    const target = { kind: 'global' as const }
    const disable = vi.fn(async (_packageId: string, moduleId: string) => {
      if (moduleId === 'first') throw new Error('permission denied')
    })
    const result = await toggleExtensionPackage({ packageId: 'example', target, modules: modules(true), enabled: false, enable: vi.fn(), disable })
    expect(result).toEqual({ completed: ['second'], failed: [{ moduleId: 'first', message: 'permission denied' }], untouched: [] })
    expect(disable).toHaveBeenCalledTimes(2)
  })
})
