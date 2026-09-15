import { describe, expect, it } from 'vitest'
import {
  withStudioServer,
  callRpc,
  authenticatedFetch,
} from '../studio-server/helpers.js'

describe('Card polyglot package roundtrip real pipeline', () => {
  it('exports a full Card with media asset to Polyglot PNG and re-imports into a clean workspace without data loss', async () => {
    let exportedPngBytes: Uint8Array

    // 1. 在第一个独立工作区中构建完整 Card 并导出
    await withStudioServer(async port => {
      // 1.1 上传真实的 Avatar 图片
      const fakeAvatar = Buffer.from('RAW_PNG_AVATAR_PAYLOAD_FOR_REAL_PIPELINE')
      const upload = await authenticatedFetch(port, '/assets', {
        method: 'POST',
        headers: {
          'content-type': 'image/png',
          'x-loom-asset-kind': 'card.avatar',
          'x-loom-asset-label': 'Avatar',
        },
        body: fakeAvatar,
      })
      expect(upload.status).toBe(201)
      const { asset } = (await upload.json()) as { asset: { id: string } }

      // 1.2 创建 Card 并绑定 Avatar
      const created = await callRpc<{ card: { id: string } }>(port, 'application.createCard', {
        name: '沧海遗珠',
        description: '位于深海之下失落古城的探险记录。包含多语言与特殊符号。',
        media: { avatarAssetId: asset.id },
      })
      const cardId = created.card.id

      // 1.3 导出为 Polyglot PNG
      const exportResponse = await authenticatedFetch(port, `/cards/${cardId}/export.polyglot.png`)
      expect(exportResponse.status).toBe(200)
      expect(exportResponse.headers.get('content-type')).toBe('image/png')
      exportedPngBytes = new Uint8Array(await exportResponse.arrayBuffer())
      expect(exportedPngBytes.byteLength).toBeGreaterThan(100)
    })

    // 2. 在全新的第二个独立工作区中重新导入该 Polyglot PNG
    await withStudioServer(async port => {
      const importResponse = await authenticatedFetch(port, '/cards/import/png', {
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        body: exportedPngBytes,
      })
      expect(importResponse.status).toBe(201)
      const imported = (await importResponse.json()) as {
        card: {
          id: string
          name: string
          description: string
          media?: { avatarAssetId?: string }
        }
      }

      // 2.1 校验卡片核心元数据 100% 等价
      expect(imported.card.name).toBe('沧海遗珠')
      expect(imported.card.description).toBe('位于深海之下失落古城的探险记录。包含多语言与特殊符号。')
      expect(imported.card.media?.avatarAssetId).toBeDefined()

      // 2.2 校验解包后的二进制头像资产完整可读且内容完全一致
      const readAsset = await authenticatedFetch(
        port,
        `/assets/${imported.card.media!.avatarAssetId}`,
      )
      expect(readAsset.status).toBe(200)
      const downloadedBytes = Buffer.from(await readAsset.arrayBuffer())
      expect(downloadedBytes.toString()).toBe('RAW_PNG_AVATAR_PAYLOAD_FOR_REAL_PIPELINE')
    })
  })
})
