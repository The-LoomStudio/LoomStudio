import type { JsonValue } from '@loom-studio/shared'
import type { NetworkProxyMode, NetworkSettingsStore } from '../../platform/network-settings.js'

export function callSettingsRpc(store: NetworkSettingsStore, method: string, params: JsonValue | undefined): JsonValue {
  if (method === 'settings.network.get') return store.get() as unknown as JsonValue
  if (method !== 'settings.network.update') throw new Error(`Settings RPC method not found: ${method}`)
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('Settings params must be an object')
  const proxyMode = Reflect.get(params, 'proxyMode')
  const proxyUrl = Reflect.get(params, 'proxyUrl')
  if (proxyMode !== 'system' && proxyMode !== 'direct' && proxyMode !== 'manual') throw new Error('Invalid network proxy mode')
  if (proxyUrl !== undefined && typeof proxyUrl !== 'string') throw new Error('proxyUrl must be a string')
  return store.update({
    proxyMode: proxyMode as NetworkProxyMode,
    ...(typeof proxyUrl === 'string' ? { proxyUrl } : {}),
  }) as unknown as JsonValue
}
