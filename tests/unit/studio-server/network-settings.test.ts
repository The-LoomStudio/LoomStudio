import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNetworkSettingsStore } from '../../../apps/studio-server/src/platform/network-settings.js'

const directories: string[] = []
function settingsFile() {
  const directory = mkdtempSync(join(tmpdir(), 'loom-network-'))
  directories.push(directory)
  return join(directory, 'network.json')
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('network settings store', () => {
  it('defaults to the detected system proxy', () => {
    const store = createNetworkSettingsStore({
      filename: settingsFile(),
      resolveSystemProxyUrl: () => 'http://127.0.0.1:7890',
    })

    expect(store.get()).toEqual({ proxyMode: 'system', systemProxyDetected: true })
    expect(store.resolveProxyUrl()).toBe('http://127.0.0.1:7890')
  })

  it('persists manual and direct proxy modes', () => {
    const filename = settingsFile()
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

  it('keeps the active settings when persistence fails', () => {
    const filename = settingsFile()
    const store = createNetworkSettingsStore({ filename, resolveSystemProxyUrl: () => 'http://system-proxy:7890' })
    const previous = store.update({ proxyMode: 'manual', proxyUrl: 'https://proxy.example:8443' })
    rmSync(filename)
    mkdirSync(filename)

    expect(() => store.update({ proxyMode: 'direct' })).toThrow()
    expect(store.get()).toEqual(previous)
    expect(store.resolveProxyUrl()).toBe('https://proxy.example:8443')
  })

  it.each([
    'http://fr010-user:fr010-secret@proxy.example:8080',
    'https://fr010-user@proxy.example',
    'http://:fr010-secret@proxy.example',
    'http://fr010%2Duser:fr010%2Dsecret@proxy.example',
  ])('rejects manual userinfo without changing memory or the saved file (%s)', proxyUrl => {
    const filename = settingsFile()
    const store = createNetworkSettingsStore({ filename, resolveSystemProxyUrl: () => undefined })
    const previous = store.update({ proxyMode: 'manual', proxyUrl: 'https://proxy.example:8443' })
    const saved = readFileSync(filename, 'utf8')
    expect(() => store.update({ proxyMode: 'manual', proxyUrl }))
      .toThrow('Manual proxy authentication is not supported; remove the username and password')
    expect(store.get()).toEqual(previous)
    expect(store.resolveProxyUrl()).toBe('https://proxy.example:8443')
    expect(readFileSync(filename, 'utf8')).toBe(saved)
    const reopened = createNetworkSettingsStore({ filename, resolveSystemProxyUrl: () => undefined })
    expect(reopened.get()).toEqual(previous)
  })

  it('does not create a configuration file for rejected credentials', () => {
    const filename = settingsFile()
    const store = createNetworkSettingsStore({ filename, resolveSystemProxyUrl: () => 'http://system-proxy' })
    expect(() => store.update({ proxyMode: 'manual', proxyUrl: 'http://fr010-user:fr010-secret@proxy' })).toThrow('authentication is not supported')
    expect(existsSync(filename)).toBe(false)
    expect(store.get().proxyMode).toBe('system')
  })

  it('fails startup for existing credential-bearing settings without fallback or rewriting the file', () => {
    const filename = settingsFile()
    const text = JSON.stringify({ proxyMode: 'manual', proxyUrl: 'https://fr010-user:fr010-secret@proxy.example' })
    writeFileSync(filename, text)
    const resolveSystemProxyUrl = vi.fn(() => 'http://alternative-proxy')
    expect(() => createNetworkSettingsStore({ filename, resolveSystemProxyUrl }))
      .toThrow('Manual proxy authentication is not supported; remove the username and password')
    expect(resolveSystemProxyUrl).not.toHaveBeenCalled()
    expect(readFileSync(filename, 'utf8')).toBe(text)
  })

  it.each([
    ['{"proxyMode":"manual","proxyUrl":"fr010-secret"', 'Invalid network settings JSON'],
    ['null', 'Invalid network settings'],
    ['{"proxyMode":"unknown","proxyUrl":"fr010-secret"}', 'Invalid network proxy mode'],
    ['{"proxyMode":"manual","proxyUrl":"https://fr010-user:fr010-secret@"}', 'Manual proxy URL is invalid'],
    ['{"proxyMode":"manual","proxyUrl":"socks5://fr010-user:fr010-secret@proxy"}', 'Proxy URL must use http or https'],
  ])('fails invalid stored settings with a secret-free error (%s)', (text, message) => {
    const filename = settingsFile()
    writeFileSync(filename, text)
    let failure: unknown
    try {
      createNetworkSettingsStore({ filename, resolveSystemProxyUrl: () => 'http://alternative-proxy' })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(message)
    expect((failure as Error).stack).not.toContain('fr010-user')
    expect((failure as Error).stack).not.toContain('fr010-secret')
    expect(failure).not.toHaveProperty('input')
    expect(failure).not.toHaveProperty('cause')
    expect(readFileSync(filename, 'utf8')).toBe(text)
  })

  it('does not treat file access errors as absent settings', () => {
    const filename = settingsFile()
    mkdirSync(filename)
    expect(() => createNetworkSettingsStore({ filename, resolveSystemProxyUrl: () => undefined })).toThrow()
  })

  it.each(['system', 'direct'] as const)('keeps %s behavior unchanged and ignores an unused manual URL', proxyMode => {
    const filename = settingsFile()
    const store = createNetworkSettingsStore({
      filename, resolveSystemProxyUrl: () => 'http://system-user:system-password@system-proxy',
    })
    expect(store.update({ proxyMode, proxyUrl: 'http://unused-user:unused-password@unused-proxy' }))
      .toEqual({ proxyMode, systemProxyDetected: true })
    expect(JSON.parse(readFileSync(filename, 'utf8'))).toEqual({ proxyMode })
    expect(store.resolveProxyUrl()).toBe(proxyMode === 'system' ? 'http://system-user:system-password@system-proxy' : undefined)
  })
})
