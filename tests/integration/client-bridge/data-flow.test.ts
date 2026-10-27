import { createKernelBridge } from '../../support/kernel-bridge.js'
import { createExtensionHostHarness as createKernelHarness } from '../../contract/extension-host/helpers.js'

import { describe, expect, it } from 'vitest'

describe('client bridge data-flow integration', () => {
  it('keeps each request payload associated with its call', async () => {
    const { kernel } = createKernelHarness()
    const calls: Array<{ method: string; params?: import('@loom-studio/shared').JsonValue }> = []
    await kernel.start()
    const bridge = createKernelBridge(kernel, calls)
    await bridge.call('system.ping', { echo: 'one' })
    await bridge.call('system.ping', { echo: 'two' })

    expect(calls).toEqual([{ method: 'system.ping', params: { echo: 'one' } }, { method: 'system.ping', params: { echo: 'two' } }])
  })

  it.each(['missing.method'])('surfaces unavailable method %s and remains usable afterward', async method => {
    const { kernel } = createKernelHarness()
    await kernel.start()
    const bridge = createKernelBridge(kernel)
    await expect(bridge.call(method)).rejects.toThrow(`RPC method not found: ${method}`)
    const ping = await bridge.call<{ ok: boolean }>('system.ping')

    expect(ping.ok).toBe(true)
  })
})
