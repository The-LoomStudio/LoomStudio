import type { ClientExtensionDataApi } from '../../../apps/studio-client/src/features/extension-renderers/model/client-extension-host.js'

// Tests must explicitly provide the data capabilities they exercise.
export function createUnavailableClientExtensionDataApi(): ClientExtensionDataApi {
  return {
    configs: {
      list: () => Promise.reject(new Error('Client extension Config API is unavailable')),
      get: () => Promise.reject(new Error('Client extension Config API is unavailable')),
      upsert: () => Promise.reject(new Error('Client extension Config API is unavailable')),
    },
    records: {
      list: () => Promise.reject(new Error('Client extension Record API is unavailable')),
      get: () => Promise.reject(new Error('Client extension Record API is unavailable')),
    },
    state: {
      get: () => Promise.reject(new Error('Client extension State API is unavailable')),
    },
    history: {
      project: () => Promise.reject(new Error('Client extension History API is unavailable')),
      extract: () => Promise.reject(new Error('Client extension History API is unavailable')),
    },
    imports: { commit: () => Promise.reject(new Error('Client extension Import API is unavailable')) },
    rpc: {
      call: () => Promise.reject(new Error('Client extension RPC API is unavailable')),
    },
    assets: {
      url: assetId => `/assets/${encodeURIComponent(assetId)}`,
    },
  }
}
