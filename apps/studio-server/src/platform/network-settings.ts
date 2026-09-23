import { readFileSync } from 'node:fs'
import { writeJsonAtomicallySync } from './atomic-json.js'

export type NetworkProxyMode = 'system' | 'direct' | 'manual'

export type NetworkSettings = {
  proxyMode: NetworkProxyMode
  proxyUrl?: string
}

export type NetworkSettingsView = NetworkSettings & {
  systemProxyDetected: boolean
}

export type NetworkSettingsStore = {
  get(): NetworkSettingsView
  update(input: NetworkSettings): NetworkSettingsView
  resolveProxyUrl(): string | undefined
}

export function createNetworkSettingsStore(options: {
  filename: string
  resolveSystemProxyUrl(): string | undefined
}): NetworkSettingsStore {
  let settings = readSettings(options.filename)

  return {
    get: () => toView(settings, options.resolveSystemProxyUrl()),
    update: input => {
      const next = normalizeSettings(input)
      persistSettings(options.filename, next)
      settings = next
      return toView(settings, options.resolveSystemProxyUrl())
    },
    resolveProxyUrl: () => {
      if (settings.proxyMode === 'direct') return undefined
      if (settings.proxyMode === 'manual') return settings.proxyUrl
      return options.resolveSystemProxyUrl()
    },
  }
}

function readSettings(filename: string): NetworkSettings {
  let text: string
  try {
    text = readFileSync(filename, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { proxyMode: 'system' }
    throw error
  }
  let input: NetworkSettings
  try {
    input = JSON.parse(text) as NetworkSettings
  } catch {
    throw new Error('Invalid network settings JSON')
  }
  return normalizeSettings(input)
}

function normalizeSettings(input: NetworkSettings): NetworkSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid network settings')
  if (input.proxyMode === 'system' || input.proxyMode === 'direct') return { proxyMode: input.proxyMode }
  if (input.proxyMode !== 'manual') throw new Error('Invalid network proxy mode')
  const proxyUrl = typeof input.proxyUrl === 'string' ? input.proxyUrl.trim() : undefined
  if (!proxyUrl) throw new Error('Manual proxy URL is required')
  let url: URL
  try {
    url = new URL(proxyUrl)
  } catch {
    throw new Error('Manual proxy URL is invalid')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Proxy URL must use http or https')
  if (url.username || url.password) throw new Error('Manual proxy authentication is not supported; remove the username and password')
  return { proxyMode: 'manual', proxyUrl }
}

function persistSettings(filename: string, settings: NetworkSettings): void {
  writeJsonAtomicallySync(filename, settings)
}

function toView(settings: NetworkSettings, systemProxyUrl: string | undefined): NetworkSettingsView {
  return {
    ...settings,
    systemProxyDetected: Boolean(systemProxyUrl),
  }
}
