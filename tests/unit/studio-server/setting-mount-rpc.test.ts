import { describe, expect, it, vi } from 'vitest'
import type { ApplicationRuntime } from '@loom-studio/application-runtime'
import { handleWorkspacesRpc } from '../../../apps/studio-server/src/rpc/handlers/application/workspaces.js'

describe('Setting mount RPC input', () => {
  it('accepts mount identities and new resources as well as the legacy ID list', async () => {
    const replaceSettingMounts = vi.fn(async () => ({ mounts: [], mutation: { changesetId: 'change' } }))
    const runtime = { replaceSettingMounts } as unknown as ApplicationRuntime
    const source = { kind: 'preset', id: 'preset' }
    const input = { source, mounts: [{ id: 'missing-mount' }, { settingResourceId: 'new-setting' }] }
    await handleWorkspacesRpc(runtime, 'application.replaceSettingMounts', input)
    expect(replaceSettingMounts).toHaveBeenLastCalledWith(input, undefined)
    const legacy = { source, settingResourceIds: ['setting'] }
    await handleWorkspacesRpc(runtime, 'application.replaceSettingMounts', legacy)
    expect(replaceSettingMounts).toHaveBeenLastCalledWith(legacy, undefined)
    await handleWorkspacesRpc(runtime, 'application.replaceSettingMounts', { source, mounts: [] })
    expect(replaceSettingMounts).toHaveBeenLastCalledWith({ source, mounts: [] }, undefined)
  })

  it('rejects malformed or ambiguous lists before calling the runtime', async () => {
    const replaceSettingMounts = vi.fn()
    const runtime = { replaceSettingMounts } as unknown as ApplicationRuntime
    const source = { kind: 'preset', id: 'preset' }
    for (const params of [
      { source },
      { source, mounts: [], settingResourceIds: [] },
      { source, mounts: [{ id: 1 }] },
    ]) {
      await expect(handleWorkspacesRpc(runtime, 'application.replaceSettingMounts', params)).rejects.toThrow()
    }
    expect(replaceSettingMounts).not.toHaveBeenCalled()
  })
})
