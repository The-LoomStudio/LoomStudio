import { describe, expect, it } from 'vitest'
import { parseMacSystemProxy, resolveSystemProxyUrl } from '../../../apps/studio-server/src/system-proxy.js'

describe('system proxy resolution', () => {
  it('prefers an explicit proxy environment variable', () => {
    expect(resolveSystemProxyUrl({
      environment: { HTTPS_PROXY: 'http://proxy.example:8080' },
      platform: 'darwin',
      readMacProxy: () => { throw new Error('should not run') },
    })).toBe('http://proxy.example:8080')
  })

  it('reads the enabled macOS HTTPS proxy', () => {
    expect(parseMacSystemProxy(`
      HTTPEnable : 1
      HTTPProxy : 127.0.0.1
      HTTPPort : 7890
      HTTPSEnable : 1
      HTTPSProxy : 127.0.0.1
      HTTPSPort : 7890
    `)).toBe('http://127.0.0.1:7890')
  })

  it('ignores a disabled macOS proxy', () => {
    expect(parseMacSystemProxy(`
      HTTPSEnable : 0
      HTTPSProxy : 127.0.0.1
      HTTPSPort : 7890
    `)).toBeUndefined()
  })
})
