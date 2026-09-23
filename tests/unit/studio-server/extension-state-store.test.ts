import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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
      updatedAt,
    })
  })
})
