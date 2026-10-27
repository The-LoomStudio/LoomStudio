import { describe, expect, it } from 'vitest'
import {
  convertSillyTavernCard,
  convertSillyTavernLorebook,
  convertSillyTavernPreset,
  extractStCardFromPng,
  isPngFile,
  sniffData,
} from '@loom-studio/sillytavern-importer'
import type { SillyTavernPresetData } from '../../../extensions/st-data-compat/src/types.js'

function createMockPngWithText(keyword: string, text: string): Uint8Array {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(1, 0)
  ihdrData.writeUInt32BE(1, 4)
  ihdrData[8] = 8 // bit depth
  ihdrData[9] = 6 // color type RGBA

  const makeChunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const typeBuf = Buffer.from(type, 'latin1')
    const crc = Buffer.alloc(4) // dummy crc for test
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

describe('SillyTavern Importer Extension', () => {
  it('imports native greetings as single bodies with distinct non-index IDs', () => {
    const { artifact } = convertSillyTavernCard({
      spec: 'chara_card_v2', spec_version: '2.0',
      data: { name: 'Greetings', first_mes: 'Default body', alternate_greetings: ['Alternative body', 'Another body'] },
    })
    const opening = artifact.card.opening
    if (!opening || typeof opening === 'string') throw new Error('Expected structured opening')
    const candidates = [opening, ...(opening.alternatives ?? [])]
    expect(candidates.map(candidate => candidate.content)).toEqual(['Default body', 'Alternative body', 'Another body'])
    expect(new Set(candidates.map(candidate => candidate.id)).size).toBe(3)
    for (const candidate of candidates) {
      expect(candidate.id).toMatch(/^[a-f0-9-]{36}$/)
      expect(candidate).not.toHaveProperty('entries')
      expect(candidate).not.toHaveProperty('role')
    }
  })

  it('identifies and extracts Card V3 from PNG chunk', () => {
    const mockCardV3 = {
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: 'Seraphina The Mage',
        description: 'A powerful celestial sorceress.',
        system_prompt: 'Respond with mystical arcane knowledge.',
        first_mes: 'Greetings, mortal traveler.',
        post_history_instructions: 'Always ensure your spell incantations rhyme.',
        character_book: {
          name: 'Arcane Codex',
          entries: [
            {
              id: 1,
              keys: ['fireball', 'pyro'],
              comment: 'Fireball Spell',
              content: 'Fireball creates an explosion of arcane heat.',
              constant: false,
              selective: true,
              position: 'before_char',
            },
            {
              id: 2,
              keys: ['mvu_law'],
              comment: 'Status Law (atDepth 0)',
              content: 'Update variable {{mana}} upon spell casting.',
              constant: true,
              position: 'at_depth',
              depth: 0,
            },
          ],
        },
      },
    }

    const png = createMockPngWithText('ccv3', JSON.stringify(mockCardV3))
    expect(isPngFile(png)).toBe(true)

    const sniff = sniffData(png)
    expect(sniff.detected).toBe(true)
    expect(sniff.format).toBe('st.card.png')
    expect(sniff.summary).toContain('Seraphina The Mage')

    const extracted = extractStCardFromPng(png)
    expect(extracted).not.toBeNull()
    expect(extracted?.format).toBe('st.card.v3')

    const conversion = convertSillyTavernCard(png)
    const artifact = conversion.artifact
    expect(artifact.schemaVersion).toBe(4)
    expect(artifact.card.name).toBe('Seraphina The Mage')
    expect(artifact.card.preset?.system).toBe('Respond with mystical arcane knowledge.')
    expect(artifact.card.opening).toEqual({
      id: expect.any(String), content: 'Greetings, mortal traveler.',
    })

    // Context assets check: Arcane Codex setting module + post-session module
    expect(artifact.contextAssets.length).toBe(2)
    const lorebookModule = artifact.contextAssets.find(a => a.category === 'lore' && a.label === 'Arcane Codex')
    expect(lorebookModule).toBeDefined()
    expect(lorebookModule?.kind).toBe('module')
    expect(lorebookModule?.children?.length).toBe(2)

    const fireballAsset = lorebookModule?.children?.find(a => a.label === 'Fireball Spell')
    expect(fireballAsset).toBeDefined()
    expect(fireballAsset?.capabilities?.targetAnchorId).toBe('@lore.lower')
    expect(fireballAsset?.capabilities?.activation).toEqual({
      kind: 'keyword',
      keywords: ['fireball', 'pyro'],
      caseSensitive: false,
    })

    const mvuAsset = lorebookModule?.children?.find(a => a.label === 'Status Law (atDepth 0)')
    expect(mvuAsset).toBeDefined()
    expect(mvuAsset?.capabilities?.targetAnchorId).toBe('@chat.session.post')
    expect(mvuAsset?.capabilities?.activation).toEqual({ kind: 'always' })

    const postSessionModule = artifact.contextAssets.find(a => a.category === 'preset')
    expect(postSessionModule).toBeDefined()
    expect(postSessionModule?.children?.length).toBe(1)
    const postHistoryAsset = postSessionModule?.children?.[0]
    expect(postHistoryAsset?.label).toBe('Post-History Instructions')
    expect(postHistoryAsset?.capabilities?.targetAnchorId).toBe('@chat.session.post')
    expect(postHistoryAsset?.body).toBe('Always ensure your spell incantations rhyme.')

    expect(artifact.extensionPayloads).toBeUndefined()
    expect(artifact.card.lore).toBeUndefined()
    expect(isPngFile(conversion.avatarBytes!)).toBe(true)
    expect(extractStCardFromPng(conversion.avatarBytes!)).toBeNull()
    expect(conversion.avatarBytes!.byteLength).toBeLessThan(png.byteLength)
  })

  it('identifies and converts SillyTavern Lorebook JSON', () => {
    const mockLorebook = {
      name: 'Eldoria Realm Lore',
      description: 'Historical records of Eldoria.',
      entries: {
        entry_1: {
          id: 101,
          keys: ['capital', 'astoria'],
          comment: 'Capital City',
          content: 'Astoria is the bustling capital surrounded by silver walls.',
          constant: false,
          position: 'before_char',
          order: 10,
        },
        entry_2: {
          id: 102,
          keys: ['rules of engagement'],
          comment: 'Combat Rules (End of Prompt)',
          content: 'Every battle must strictly abide by the Chivalric Code.',
          constant: true,
          position: 'at_depth',
          depth: 1,
          order: 99,
        },
        entry_3: {
          id: 103,
          keys: [],
          comment: 'Constant World Law',
          content: 'Magic is strictly governed by the High Council.',
          constant: true,
          position: 'after_char',
          order: 50,
        },
      },
    }

    const sniff = sniffData(mockLorebook)
    expect(sniff.detected).toBe(true)
    expect(sniff.format).toBe('st.lorebook.json')

    const conversion = convertSillyTavernLorebook(mockLorebook)
    expect(conversion.artifact.format).toBe('loom.promptResource')
    expect(conversion.artifact.resourceKind).toBe('lore')
    expect(conversion.artifact.rootNode.label).toBe('Eldoria Realm Lore')

    const children = conversion.artifact.rootNode.children ?? []
    expect(children).toHaveLength(3)

    const normalEntry = children.find((c: any) => c.label === 'Capital City')
    expect(normalEntry?.capabilities?.targetAnchorId).toBe('@lore.lower')
    expect(normalEntry?.capabilities?.activation).toEqual({
      kind: 'keyword',
      keywords: ['capital', 'astoria'],
      caseSensitive: false,
    })

    const constantEntry = children.find((c: any) => c.label === 'Constant World Law')
    expect(constantEntry?.capabilities?.targetAnchorId).toBe('@lore.stable')
    expect(constantEntry?.capabilities?.activation).toEqual({ kind: 'always' })

    const depthEntry = children.find((c: any) => c.label === 'Combat Rules (End of Prompt)')
    expect(depthEntry?.capabilities?.targetAnchorId).toBe('@chat.session.post')
    expect(depthEntry?.capabilities?.activation).toEqual({ kind: 'always' })
  })

  it('identifies and converts SillyTavern Preset JSON with Auto-Squash', () => {
    const mockPreset: SillyTavernPresetData = {
      prompts: [
        {
          identifier: 'main',
          name: 'Main System Prompt',
          role: 'system',
          content: 'You are an advanced story assistant.',
          system_prompt: true,
          order: 0,
        },
        {
          identifier: 'worldInfoBefore',
          name: 'World Info Before',
          role: 'system',
          content: 'Context before characters.',
          order: 10,
        },
        {
          identifier: 'chatHistory',
          name: 'Chat History',
          marker: true,
          order: 50,
        },
        {
          identifier: 'postHistoryInstructions',
          name: 'Post-History Prompt',
          role: 'system',
          content: 'Maintain a high level of detail in narration.',
          order: 60,
        },
        {
          identifier: 'formatGuide',
          name: 'Format Guide',
          role: 'system',
          content: 'Wrap spoken dialogue in quotation marks.',
          order: 70,
        },
      ],
      temperature: 0.85,
      top_p: 0.9,
    }

    const sniff = sniffData(mockPreset)
    expect(sniff.detected).toBe(true)
    expect(sniff.format).toBe('st.preset.json')

    const conversion = convertSillyTavernPreset(mockPreset, 'MingYue Preset')
    expect(conversion.artifact.format).toBe('loom.promptResource')
    expect(conversion.artifact.resourceKind).toBe('preset')
    expect(conversion.artifact.rootNode.label).toBe('MingYue Preset')

    const rootChildren = conversion.artifact.rootNode.children ?? []
    // Session expands to native messages between the surrounding Message blocks.
    expect(rootChildren).toHaveLength(4)
    expect(rootChildren.map(node => node.kind)).toEqual(['message', 'virtual', 'message', 'message'])

    const systemBlock = rootChildren[0]
    expect(systemBlock?.label).toBe('System Message')
    expect(systemBlock?.children?.some((c: any) => c.label === 'Main System Prompt')).toBe(true)

    const sessionBlock = rootChildren[1]
    expect(sessionBlock?.capabilities?.targetAnchorId).toBe('@chat.session')
    expect(sessionBlock?.children).toBeUndefined()

    const postSessionBlock = rootChildren[2]
    expect(postSessionBlock?.label).toBe('Post Session Message')
    expect(postSessionBlock?.children?.some((c: any) => c.label === 'Post-History Prompt')).toBe(true)

    const userInputBlock = rootChildren[3]
    expect(userInputBlock?.label).toBe('User Input Message')
    expect(userInputBlock?.children?.[0]?.capabilities?.targetAnchorId).toBe('@chat.input')
  })
})
