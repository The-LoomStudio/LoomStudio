import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { extensionInstallationId } from '@loom-studio/application-runtime'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createExtensionStateStore,
  type ExtensionModuleDesiredState,
} from '../../../apps/studio-server/src/extensions/extension-state-store.js'

const updatedAt = '2026-09-22T00:00:00.000Z'
let directory: string
let filename: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'loom-extension-state-'))
  filename = join(directory, 'state.json')
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('Extension State Store capability persistence', () => {
  it('isolates grants, enabled state and removal by installation across restart', async () => {
    const store = createExtensionStateStore({ filename, now: () => updatedAt })
    await store.load()
    const a = { kind: 'card' as const, cardId: 'A' }
    const b = { kind: 'card' as const, cardId: 'B' }
    const disabled = { enabled: false, grantedEventCapabilities: [], grantedAssetCapabilities: [] }
    await store.set('example.state', 'server', { ...disabled, enabled: true, grantedEventCapabilities: ['state'] })
    await store.set('example.state', 'server', { ...disabled, grantedAssetCapabilities: ['assets.read'] }, a)
    await store.set('example.state', 'server', { ...disabled, enabled: true }, b)
    const reloaded = createExtensionStateStore({ filename, now: () => updatedAt })
    await reloaded.load()
    expect(reloaded.get('example.state', 'server')).toMatchObject({ enabled: true, grantedEventCapabilities: ['state'] })
    expect(reloaded.get('example.state', 'server', a)).toMatchObject({
      enabled: false, grantedEventCapabilities: [], grantedAssetCapabilities: ['assets.read'],
    })
    expect(reloaded.get('example.state', 'server', b)).toMatchObject({ enabled: true, grantedEventCapabilities: [] })
    await reloaded.deletePackage('example.state', a)
    expect(reloaded.get('example.state', 'server', a)).toBeUndefined()
    expect(reloaded.get('example.state', 'server', b)?.enabled).toBe(true)
    expect(reloaded.get('example.state', 'server')?.grantedEventCapabilities).toEqual(['state'])
  })

  it.each([2, 3])('adopts version %i grants only as global and writes version 4 on mutation', async version => {
    await writeFile(filename, JSON.stringify({
      version, packages: { 'example.state': { modules: { server: {
        enabled: true, grants: { 'events.subscribe': ['state'], assets: ['assets.read'] }, updatedAt,
      } } } },
    }))
    const store = createExtensionStateStore({ filename, now: () => updatedAt })
    await store.load()
    const target = { kind: 'card' as const, cardId: 'A' }
    expect(store.get('example.state', 'server', target)).toBeUndefined()
    expect(store.get('example.state', 'server')).toMatchObject({
      enabled: true, grantedEventCapabilities: ['state'], grantedAssetCapabilities: ['assets.read'],
    })
    await store.set('example.state', 'server', {
      enabled: false, grantedEventCapabilities: [], grantedAssetCapabilities: [],
    }, target)
    const persisted = JSON.parse(await readFile(filename, 'utf8'))
    expect(persisted.version).toBe(4)
    expect(persisted.packages).toBeUndefined()
    expect(Object.keys(persisted.installations).sort()).toEqual([
      extensionInstallationId('example.state', { kind: 'global' }),
      extensionInstallationId('example.state', target),
    ].sort())
    const reloaded = createExtensionStateStore({ filename, now: () => updatedAt })
    await reloaded.load()
    expect(reloaded.get('example.state', 'server')).toEqual(store.get('example.state', 'server'))
    expect(reloaded.get('example.state', 'server', target)?.enabled).toBe(false)
  })

  it('serializes removal after a queued creation of the same installation', async () => {
    const store = createExtensionStateStore({ filename, now: () => updatedAt })
    await store.load()
    const created = store.set('example.state', 'server', {
      enabled: false, grantedEventCapabilities: [], grantedAssetCapabilities: [],
    })
    const removed = store.deletePackage('example.state')
    await created
    expect(await removed).toBe(true)
    expect(store.get('example.state', 'server')).toBeUndefined()
  })

  it('round-trips every supported event category and asset capability through a fresh store', async () => {
    const store = createExtensionStateStore({ filename, now: () => updatedAt })
    await store.load()
    const input: Omit<ExtensionModuleDesiredState, 'updatedAt'> = {
      enabled: true,
      grantedEventCapabilities: [
        'documents',
        'narrative',
        'agent',
        'diagnostics',
        'platform-data',
        'state',
        'extension:example.state_1-test',
      ],
      grantedAssetCapabilities: ['assets.publish', 'assets.read'],
      grantedUiCapabilities: ['ui.notify'],
    }

    await expect(store.set('example.state', 'server', input)).resolves.toEqual({ ...input, updatedAt })

    const reloaded = createExtensionStateStore({ filename, now: () => updatedAt })
    await reloaded.load()
    expect(reloaded.get('example.state', 'server')).toEqual({ ...input, updatedAt })
  })

  it.each([
    { label: 'unknown category', grants: ['state', 'unknown'] },
    { label: 'non-string category', grants: ['state', 1] },
    { label: 'empty extension namespace', grants: ['extension:'] },
    { label: 'invalid extension namespace', grants: ['extension:bad/name'] },
    { label: 'non-array grants', grants: 'state' },
  ])('rejects persisted $label', async ({ grants }) => {
    await writeFile(filename, JSON.stringify({
      version: 3,
      packages: {
        'example.state': {
          modules: {
            server: {
              enabled: true,
              grants: { 'events.subscribe': grants, assets: [] },
              updatedAt,
            },
          },
        },
      },
    }))
    const store = createExtensionStateStore({ filename, now: () => updatedAt })

    await expect(store.load()).rejects.toThrow('Invalid events.subscribe grants: example.state/server')
  })

  it('still rejects invalid asset grants alongside a valid state grant', async () => {
    await writeFile(filename, JSON.stringify({
      version: 3,
      packages: {
        'example.state': {
          modules: {
            server: {
              enabled: true,
              grants: { 'events.subscribe': ['state'], assets: ['assets.write'] },
              updatedAt,
            },
          },
        },
      },
    }))
    const store = createExtensionStateStore({ filename, now: () => updatedAt })

    await expect(store.load()).rejects.toThrow('Invalid asset grants: example.state/server')
  })

  it('continues reading version 2 states without asset grants', async () => {
    await writeFile(filename, JSON.stringify({
      version: 2,
      packages: {
        'example.state': {
          modules: {
            server: {
              enabled: true,
              grants: { 'events.subscribe': ['documents'] },
              updatedAt,
            },
          },
        },
      },
    }))
    const store = createExtensionStateStore({ filename, now: () => updatedAt })

    await store.load()
    expect(store.get('example.state', 'server')).toEqual({
      enabled: true,
      grantedEventCapabilities: ['documents'],
      grantedAssetCapabilities: [],
      grantedUiCapabilities: [],
      updatedAt,
    })
  })
})
