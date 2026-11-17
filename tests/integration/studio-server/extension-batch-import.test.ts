import { describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { crc32 } from 'node:zlib'
import { defaultCardPng } from '../../../apps/studio-server/src/codecs/card-png.js'
import { authenticatedFetch, callRpc, withStudioServer } from './helpers.js'

function characterPng() {
  const data = Buffer.from(`chara\0${Buffer.from(JSON.stringify({
    name: 'Nested Hero', first_mes: 'Opening', alternate_greetings: ['Other opening'],
  })).toString('base64')}`)
  const chunk = Buffer.alloc(data.length + 12)
  chunk.writeUInt32BE(data.length)
  chunk.write('tEXt', 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4)
  return Buffer.concat([defaultCardPng.subarray(0, -12), chunk, defaultCardPng.subarray(-12)])
}

const owner = { packageId: 'sillytavern.importer', target: { kind: 'global' } as const }
const invokeImporter = <T>(port: number, method: string, params: unknown) =>
  callRpc<T>(port, 'extensions.invoke', { packageId: owner.packageId, target: owner.target, method, params })

describe('extension native batch import', () => {
  it('uses the real Host to import a nested Card, avatar, resources and complete history, and reports unmatched chats', async () => {
    await withStudioServer(async (port, directory) => {
      const root = join(directory, 'st-source')
      for (const folder of ['characters/group', 'chats/Hero', 'chats/Missing', 'worlds']) {
        await mkdir(join(root, folder), { recursive: true })
      }
      await writeFile(join(root, 'characters/group/Hero.png'), characterPng())
      await writeFile(join(root, 'worlds/Lore.json'), JSON.stringify({ name: 'Lore', entries: {
        0: { uid: 0, key: ['hero'], content: 'A shared world', comment: 'Setting', constant: true, disable: false },
      } }))
      await writeFile(join(root, 'chats/Hero/Evening.jsonl'), [
        { chat_metadata: {} },
        { is_user: false, mes: 'Old first message', send_date: '2026-10-01T00:00:00Z' },
        { is_user: true, mes: 'Old user message' },
        { is_user: false, mes: 'Old last message' },
      ].map(value => JSON.stringify(value)).join('\n'))
      await writeFile(join(root, 'chats/Missing/Unmatched.jsonl'), JSON.stringify({ mes: 'Unmatched' }))
      await callRpc(port, 'extensions.enableModule', { packageId: owner.packageId, moduleId: 'server' })
      const { sessionId } = await invokeImporter<{ sessionId: string }>(port, 'sillytavern.importer.migration.start', { directory: root })
      await expect.poll(async () => (await invokeImporter<{ scan: { status: string } }>(port,
        'sillytavern.importer.migration.inspect', { sessionId })).scan.status).toBe('completed')
      const report = await callRpc(port, 'extensions.importConvertedBatch', { ...owner, sessionId })
      expect(report).toEqual({ imported: 3, skipped: [{ key: 'chats/Missing/Unmatched.jsonl', reason: '没有找到聊天对应的角色卡' }] })
      const { cards } = await callRpc<{ cards: Array<{ id: string; name: string; media: { avatarAssetId: string } }> }>(port, 'application.listCards', {})
      expect(cards).toHaveLength(1)
      expect(cards[0]!.name).toBe('Nested Hero')
      expect(cards[0]!.media.avatarAssetId).toBeTruthy()
      const avatar = await authenticatedFetch(port, `/cards/${encodeURIComponent(cards[0]!.id)}/media/avatar`)
      expect(avatar.status).toBe(200)
      expect(Buffer.from(await avatar.arrayBuffer())).toEqual(defaultCardPng)
      const { timelines } = await callRpc<{ timelines: Array<{ id: string; title: string }> }>(port, 'application.listNarrativeTimelines', {})
      expect(timelines).toHaveLength(1)
      expect(timelines[0]!.title).toBe('Evening')
      const { nodes } = await callRpc<{ nodes: Array<{ body: { raw: string } }> }>(port, 'application.getNarrativePage', { timelineId: timelines[0]!.id })
      expect(nodes.map(node => node.body.raw)).toEqual(['Old first message', 'Old user message', 'Old last message'])
      await expect(callRpc(port, 'extensions.importConvertedBatch', { ...owner, sessionId })).rejects.toThrow('not found')
      expect((await callRpc<{ cards: unknown[] }>(port, 'application.listCards', {})).cards).toHaveLength(1)
    }, resolve('extensions'))
  })

  it('reports accepted writes on conversion failure and consumes the failed session', async () => {
    await withStudioServer(async port => {
      await callRpc(port, 'extensions.enableModule', { packageId: owner.packageId, moduleId: 'server' })
      const { sessionId } = await invokeImporter<{ sessionId: string }>(port, 'sillytavern.importer.migration.start', {})
      await invokeImporter(port, 'sillytavern.importer.migration.appendBatch', { sessionId, files: [
        { path: 'characters/Good.json', source: JSON.stringify({ name: 'Good' }) },
        { path: 'characters/Broken.json', source: '{broken' },
      ] })
      await expect(callRpc(port, 'extensions.importConvertedBatch', { ...owner, sessionId })).rejects.toThrow('已有 1 项写入')
      await expect(invokeImporter(port, 'sillytavern.importer.migration.inspect', { sessionId })).rejects.toThrow('not found')
      expect((await callRpc<{ cards: unknown[] }>(port, 'application.listCards', {})).cards).toHaveLength(1)
    }, resolve('extensions'))
  })
})
