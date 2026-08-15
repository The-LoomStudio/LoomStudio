import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

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
      settings = normalizeSettings(input)
      persistSettings(options.filename, settings)
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
  try {
    return normalizeSettings(JSON.parse(readFileSync(filename, 'utf8')) as NetworkSettings)
  } catch {
    return { proxyMode: 'system' }
  }
}

function normalizeSettings(input: NetworkSettings): NetworkSettings {
  if (input.proxyMode === 'system' || input.proxyMode === 'direct') return { proxyMode: input.proxyMode }
  if (input.proxyMode !== 'manual') throw new Error('Invalid network proxy mode')
  const proxyUrl = input.proxyUrl?.trim()
  if (!proxyUrl) throw new Error('Manual proxy URL is required')
  const protocol = new URL(proxyUrl).protocol
  if (protocol !== 'http:' && protocol !== 'https:') throw new Error('Proxy URL must use http or https')
  return { proxyMode: 'manual', proxyUrl }
}

function persistSettings(filename: string, settings: NetworkSettings): void {
  mkdirSync(dirname(filename), { recursive: true })
  const temporary = `${filename}.tmp`
  writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, filename)
}

function toView(settings: NetworkSettings, systemProxyUrl: string | undefined): NetworkSettingsView {
  return {
    ...settings,
    systemProxyDetected: Boolean(systemProxyUrl),
  }
}
