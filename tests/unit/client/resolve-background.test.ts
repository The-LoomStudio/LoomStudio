import { describe, expect, it } from 'vitest'
import { migrateOfficialBackground, resolveBackground } from '../../../apps/studio-client/src/features/extension-renderers/model/resolve-background.js'

const background = {
  id: 'scene', key: 'official.backgrounds/client/scene', packageId: 'official.backgrounds',
  moduleId: 'client', name: 'Scene', description: 'Scene', image: '/extensions/official.backgrounds/2.0.0/files/Assets/scene.png',
}

describe('background selection', () => {
  it('resolves the current registered URL after an update', () => {
    expect(resolveBackground({ id: background.key }, [background])).toBe(background)
  })

  it('does not render a removed registration or a legacy built-in selection', () => {
    expect(resolveBackground({ id: background.key }, [])).toBeUndefined()
    expect(resolveBackground({ id: 'harbor' }, [background])).toBeUndefined()
    expect(resolveBackground(null, [background])).toBeUndefined()
  })

  it('does not expose another Card background', () => {
    const scoped = { ...background, target: { kind: 'card' as const, cardId: 'a' } }
    expect(resolveBackground({ id: scoped.key }, [scoped], 'b')).toBeUndefined()
    expect(resolveBackground({ id: scoped.key }, [scoped], 'a')).toBe(scoped)
  })
})


it('migrates the former official client-module selection only when its static replacement exists', () => {
  const old = { id: background.key, image: '/old.png' }
  const replacement = { ...background, key: 'official.backgrounds/scene', moduleId: undefined }
  expect(migrateOfficialBackground(old, [])).toBe(old)
  expect(migrateOfficialBackground(old, [background, replacement])).toBe(old)
  expect(migrateOfficialBackground(old, [replacement])).toEqual({ id: replacement.key, image: replacement.image })
  expect(migrateOfficialBackground(null, [replacement])).toBeNull()
})
