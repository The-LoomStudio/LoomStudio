import { expect, it } from 'vitest'
import { authenticatedFetch, callRpc, withStudioServer } from './helpers.js'
import type { UserBackgroundsConfig } from '@loom-studio/application-runtime'

it('uploads a personal background, persists its catalog reference and retains the image when removed', async () => {
  await withStudioServer(async port => {
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6NVAAAAAASUVORK5CYII=', 'base64')
    const upload = await authenticatedFetch(port, '/assets', {
      method: 'POST', headers: { 'content-type': 'image/png', 'x-loom-asset-kind': 'background' }, body: bytes,
    })
    expect(upload.status).toBe(201)
    const uploaded = await upload.json() as { asset: { id: string }; url: string }
    const initial = await callRpc<{ config: UserBackgroundsConfig }>(port, 'application.getUserBackgrounds', {})
    expect(initial.config.backgrounds).toEqual([])
    const added = await callRpc<{ config: UserBackgroundsConfig }>(port, 'application.addUserBackground', {
      expectedVersion: initial.config.version, name: '个人场景', assetId: uploaded.asset.id,
    })
    expect(added.config.backgrounds).toEqual([expect.objectContaining({ name: '个人场景', assetId: uploaded.asset.id })])
    expect(await callRpc(port, 'application.getUserBackgrounds', {})).toEqual({ config: added.config })
    const image = await authenticatedFetch(port, uploaded.url)
    expect(image.status).toBe(200)
    expect(Buffer.from(await image.arrayBuffer()).equals(bytes)).toBe(true)
    const removed = await callRpc<{ config: UserBackgroundsConfig }>(port, 'application.removeUserBackground', {
      expectedVersion: added.config.version, backgroundId: added.config.backgrounds[0].id,
    })
    expect(removed.config.backgrounds).toEqual([])
    expect((await authenticatedFetch(port, uploaded.url)).status).toBe(200)
  })
})
