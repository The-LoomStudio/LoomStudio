import { describe, expect, it } from 'vitest'
import { authenticatedFetch, callRpc, withStudioServer } from './helpers.js'

function createMockPngWithText(keyword: string, text: string): Uint8Array {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(1, 0)
  ihdrData.writeUInt32BE(1, 4)
  ihdrData[8] = 8
  ihdrData[9] = 6

  const makeChunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const typeBuf = Buffer.from(type, 'latin1')
    const crc = Buffer.alloc(4)
    return Buffer.concat([len, typeBuf, data, crc])
  }

  const ihdrChunk = makeChunk('IHDR', ihdrData)
  const textPayload = Buffer.concat([
    Buffer.from(keyword, 'latin1'),
    Buffer.from([0]),
    Buffer.from(Buffer.from(text, 'utf8').toString('base64'), 'utf8'),
  ])
  const textChunk = makeChunk('tEXt', textPayload)
  const iendChunk = makeChunk('IEND', Buffer.alloc(0))

  return Buffer.concat([signature, ihdrChunk, textChunk, iendChunk])
}

describe('studio server SillyTavern silent import pipeline', () => {
  it('seamlessly imports SillyTavern PNG Card via /cards/import/png endpoint', async () => {
    await withStudioServer(async port => {
      const stCard = {
        spec: 'chara_card_v3',
        spec_version: '3.0',
        data: {
          name: 'Elena Frost',
          description: 'A wandering cryogenic archer.',
          system_prompt: 'Keep tone calm and cold.',
          first_mes: 'The blizzard is setting in.',
          post_history_instructions: 'Format all arrows in asterisks.',
          character_book: {
            name: 'Frost Lore',
            entries: [
              {
                id: 1,
                keys: ['glacier'],
                comment: 'Glacier Arrow',
                content: 'Glacier Arrow freezes targets on hit.',
                constant: false,
                position: 'before_char',
              },
              {
                id: 2,
                keys: ['mvu'],
                comment: 'Freeze Law',
                content: 'Decrease target temperature by 10.',
                constant: true,
                position: 'at_depth',
                depth: 0,
              },
            ],
          },
        },
      }

      const png = createMockPngWithText('ccv3', JSON.stringify(stCard))
      const response = await authenticatedFetch(port, '/cards/import/png', {
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        body: png,
      })

      expect(response.status).toBe(201)
      const body = await response.json() as {
        card: {
          id: string
          name: string
          description?: string
          media?: { avatarAssetId?: string }
        }
      }

      expect(body.card.name).toBe('Elena Frost')
      expect(body.card.description).toBe('A wandering cryogenic archer.')
      expect(body.card.media?.avatarAssetId).toBeDefined()

      // Verify the card's avatar asset can be read from server
      const avatarRes = await authenticatedFetch(port, `/assets/${body.card.media!.avatarAssetId}`)
      expect(avatarRes.status).toBe(200)
      expect(avatarRes.headers.get('content-type')).toBe('image/png')
    })
  })

  it('seamlessly imports SillyTavern Lorebook JSON via application.importPromptResource', async () => {
    await withStudioServer(async port => {
      const stLorebook = {
        name: 'Cyberpunk City Lore',
        entries: [
          {
            id: 10,
            keys: ['cyberdeck'],
            comment: 'Cyberdeck Specs',
            content: 'High-end neural interface terminal.',
            constant: false,
            position: 'before_char',
          },
          {
            id: 20,
            keys: ['police_dispatch'],
            comment: 'NCPD Dispatch Protocol',
            content: 'Maintain high bounty warning at session tail.',
            constant: true,
            position: 'at_depth',
            depth: 0,
          },
        ],
      }

      const result = await callRpc<{
        resource: {
          id: string
          resourceKind: string
          rootNode: { label: string; children: unknown[] }
        }
      }>(port, 'application.importPromptResource', {
        artifact: stLorebook,
      })

      expect(result.resource.resourceKind).toBe('setting')
      expect(result.resource.rootNode.label).toBe('Cyberpunk City Lore')
      expect(result.resource.rootNode.children).toHaveLength(2)
    })
  })

  it('seamlessly imports SillyTavern Preset JSON with Auto-Squash via application.importPromptResource', async () => {
    await withStudioServer(async port => {
      const stPreset = {
        prompts: [
          {
            identifier: 'main',
            name: 'Main System',
            role: 'system',
            content: 'You are an AI narrator.',
          },
          {
            identifier: 'chatHistory',
            name: 'Chat History',
            marker: true,
          },
          {
            identifier: 'postInstructions',
            name: 'Post Session Rule',
            content: 'End response with a choice.',
          },
        ],
      }

      const result = await callRpc<{
        resource: {
          id: string
          resourceKind: string
          rootNode: { label: string; children: Array<{ label: string; kind?: string }> }
        }
      }>(port, 'application.importPromptResource', {
        artifact: stPreset,
        name: 'ST Custom Preset',
      })

      expect(result.resource.resourceKind).toBe('preset')
      expect(result.resource.rootNode.label).toBe('ST Custom Preset')
      expect(result.resource.rootNode.children).toHaveLength(4)
      expect(result.resource.rootNode.children.some(c => c.label.includes('Post Session'))).toBe(true)
    })
  })
})
