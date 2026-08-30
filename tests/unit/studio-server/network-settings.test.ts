import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createNetworkSettingsStore } from '../../../apps/studio-server/src/platform/network-settings.js'

describe('network settings store', () => {
  it('defaults to the detected system proxy', () => {
    const store = createNetworkSettingsStore({
      filename: join(mkdtempSync(join(tmpdir(), 'loom-network-')), 'network.json'),
      resolveSystemProxyUrl: () => 'http://127.0.0.1:7890',
    })

    expect(store.get()).toEqual({ proxyMode: 'system', systemProxyDetected: true })
    expect(store.resolveProxyUrl()).toBe('http://127.0.0.1:7890')
  })

  it('persists manual and direct proxy modes', () => {
    const filename = join(mkdtempSync(join(tmpdir(), 'loom-network-')), 'network.json')
    const store = createNetworkSettingsStore({ filename, resolveSystemProxyUrl: () => 'http://system-proxy:7890' })

    expect(store.update({ proxyMode: 'manual', proxyUrl: ' http://manual-proxy:8080 ' })).toEqual({
      proxyMode: 'manual',
      proxyUrl: 'http://manual-proxy:8080',
      systemProxyDetected: true,
    })
    expect(store.resolveProxyUrl()).toBe('http://manual-proxy:8080')
    expect(JSON.parse(readFileSync(filename, 'utf8'))).toEqual({ proxyMode: 'manual', proxyUrl: 'http://manual-proxy:8080' })

    expect(store.update({ proxyMode: 'direct' })).toEqual({ proxyMode: 'direct', systemProxyDetected: true })
    expect(store.resolveProxyUrl()).toBeUndefined()
  })
})
