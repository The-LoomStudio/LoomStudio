import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  convertSillyTavernCard,
  convertSillyTavernLorebook,
  convertSillyTavernPreset,
  extractStCardFromPng,
  isPngFile,
  sniffData,
} from '@loom-studio/sillytavern-importer'
import type { SillyTavernPresetData } from '../../../extensions/sillytavern-importer/src/types.js'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createPromptResourceStore } from '@loom-studio/prompt-resource-store'
import { importCardBundle } from '@loom-studio/application-runtime'

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
    expect(artifact.schemaVersion).toBe(2)
    expect(artifact.card.name).toBe('Seraphina The Mage')
    expect(artifact.card.preset?.system).toBe('Respond with mystical arcane knowledge.')
    expect(artifact.card.opening).toEqual({
      entries: [{ role: 'assistant', content: 'Greetings, mortal traveler.' }],
    })

    // Context assets check: Arcane Codex setting module + post-session module
    expect(artifact.contextAssets.length).toBe(2)
    const lorebookModule = artifact.contextAssets.find(a => a.category === 'setting' && a.label === 'Arcane Codex')
    expect(lorebookModule).toBeDefined()
    expect(lorebookModule?.kind).toBe('module')
    expect(lorebookModule?.children?.length).toBe(2)

    const fireballAsset = lorebookModule?.children?.find(a => a.label === 'Fireball Spell')
    expect(fireballAsset).toBeDefined()
    expect(fireballAsset?.capabilities?.targetAnchorId).toBe('@setting.lower')
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

    // Portable payload check: untouched source stored
    expect(artifact.extensionPayloads).toHaveLength(1)
    expect(artifact.extensionPayloads?.[0]?.packageId).toBe('sillytavern.importer')
    expect(artifact.extensionPayloads?.[0]?.format).toBe('sillytavern.character+json')
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
    expect(conversion.artifact.resourceKind).toBe('setting')
    expect(conversion.artifact.rootNode.label).toBe('Eldoria Realm Lore')

    const children = conversion.artifact.rootNode.children ?? []
    expect(children).toHaveLength(3)

    const normalEntry = children.find((c: any) => c.label === 'Capital City')
    expect(normalEntry?.capabilities?.targetAnchorId).toBe('@setting.lower')
    expect(normalEntry?.capabilities?.activation).toEqual({
      kind: 'keyword',
      keywords: ['capital', 'astoria'],
      caseSensitive: false,
    })

    const constantEntry = children.find((c: any) => c.label === 'Constant World Law')
    expect(constantEntry?.capabilities?.targetAnchorId).toBe('@setting.stable')
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
    // Official Message Blocks structure: System Message, Session Message, Post Session Message, User Input Message
    expect(rootChildren).toHaveLength(4)
    expect(rootChildren.every((b: any) => b.kind === 'message')).toBe(true)

    const systemBlock = rootChildren[0]
    expect(systemBlock?.label).toBe('System Message')
    expect(systemBlock?.children?.some((c: any) => c.label === 'Main System Prompt')).toBe(true)

    const sessionBlock = rootChildren[1]
    expect(sessionBlock?.label).toBe('Session Message')
    expect(sessionBlock?.children?.[0]?.capabilities?.targetAnchorId).toBe('@chat.session')

    const postSessionBlock = rootChildren[2]
    expect(postSessionBlock?.label).toBe('Post Session Message')
    expect(postSessionBlock?.children?.some((c: any) => c.label === 'Post-History Prompt')).toBe(true)

    const userInputBlock = rootChildren[3]
    expect(userInputBlock?.label).toBe('User Input Message')
    expect(userInputBlock?.children?.[0]?.capabilities?.targetAnchorId).toBe('@chat.input')
  })

  it('successfully parses real SillyTavern cards if available on local machine', () => {
    const realCardsDir = '/Users/macbookair/SillyTavern/data/default-user/characters'
    if (!existsSync(realCardsDir)) return

    const cardPath = join(realCardsDir, 'default_Seraphina.png')
    if (existsSync(cardPath)) {
      const bytes = readFileSync(cardPath)
      const sniff = sniffData(bytes)
      expect(sniff.detected).toBe(true)
      expect(sniff.format).toBe('st.card.png')

      const converted = convertSillyTavernCard(bytes)
      expect(converted.artifact.schemaVersion).toBe(2)
      expect(converted.artifact.card.name).toBeTruthy()
      expect(converted.avatarBytes).toBeDefined()
    }
  })

  it('correctly converts real character card 指针不再前进.png with embedded character_book', async () => {
    const cardPath = join(__dirname, '../../extensions/sillytavern-importer/指针不再前进.png')
    if (!existsSync(cardPath)) return

    const bytes = readFileSync(cardPath)
    const sniff = sniffData(bytes)
    expect(sniff.detected).toBe(true)
    expect(sniff.format).toBe('st.card.png')

    const converted = convertSillyTavernCard(bytes)
    const artifact = converted.artifact

    expect(artifact.card.name).toBe('指针不再前进')
    const opening = typeof artifact.card.opening === 'object' ? artifact.card.opening : null
    expect(opening?.entries?.[0]?.content).toBeTruthy()
    expect(opening?.entries?.[0]?.content?.length).toBeGreaterThan(1000)

    // Verify embedded character_book is converted as a standalone Setting module in contextAssets
    const lorebookModule = artifact.contextAssets.find(a => a.category === 'setting' && a.label === '发条不再转动')
    expect(lorebookModule).toBeDefined()
    expect(lorebookModule?.kind).toBe('module')
    expect(lorebookModule?.children).toHaveLength(26)

    // Check stable entry (e.g. 凝滞的新日)
    const stableEntry = lorebookModule?.children?.find(c => c.label === '凝滞的新日')
    expect(stableEntry).toBeDefined()
    expect(stableEntry?.capabilities?.targetAnchorId).toBe('@setting.stable')
    expect(stableEntry?.capabilities?.activation).toEqual({ kind: 'always' })

    // Check atDepth entry (e.g. [mvu_update]变量更新规则)
    const mvuEntry = lorebookModule?.children?.find(c => c.label === '[mvu_update]变量更新规则')
    expect(mvuEntry).toBeDefined()
    expect(mvuEntry?.capabilities?.targetAnchorId).toBe('@chat.session.post')

    // End-to-end import verification: ensure importCardBundle binds the lorebook
    let seq = 0
    const createId = (p: string) => `${p}-${++seq}`
    const now = () => '2026-09-05T00:00:00.000Z'
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
    const documents = createSqliteDocumentStore({ engine })
    const promptResources = createPromptResourceStore({ engine, createId, now })

    const imported = await importCardBundle({
      artifact,
      documents,
      promptResources,
      dataEngine: engine,
    })

    expect(imported.card.promptResourceIds).toHaveLength(1)
    expect(imported.card.settingLayer?.entries).toHaveLength(26)
    const boundResourceId = imported.card.promptResourceIds![0]!
    const boundResource = await promptResources.getResource(boundResourceId)
    expect(boundResource?.label).toBe('发条不再转动')
    expect(boundResource?.resourceKind).toBe('setting')
  })

  it('correctly normalizes real Xia Jin preset with prompt_order and role-based message blocks', () => {
    const presetPath = join(__dirname, '../../extensions/sillytavern-importer/夏瑾 双鱼座 Beta 0.40.json')
    if (!existsSync(presetPath)) return

    const rawJson = readFileSync(presetPath, 'utf8')
    const result = convertSillyTavernPreset(rawJson, '夏瑾 双鱼座 Beta 0.40')
    expect(result.artifact.format).toBe('loom.promptResource')
    expect(result.artifact.resourceKind).toBe('preset')

    const rootChildren = result.artifact.rootNode.children ?? []
    expect(rootChildren.length).toBeGreaterThan(3)

    // 1. Find the main prompt ("➡️扩写/转述输入")
    const allEntries = rootChildren.flatMap((block: any) => block.children ?? [])
    const mainEntry = allEntries.find((e: any) => e.label.includes('➡️扩写/转述输入') || e.label === 'main')
    expect(mainEntry).toBeDefined()

    // It must NOT be the first entry across all blocks!
    expect(allEntries[0]?.id).not.toBe(mainEntry?.id)

    // In Xia Jin preset, main has role 'user'. It should be in a User Message Block
    const parentBlockOfMain = rootChildren.find((b: any) => b.children?.some((c: any) => c.id === mainEntry?.id))
    expect(parentBlockOfMain).toBeDefined()
    expect(parentBlockOfMain?.capabilities?.roleHint).toBe('user')

    // Find the boundary block: "🛡️准则结束"
    const endRulesEntry = allEntries.find((e: any) => e.label.includes('🛡️准则结束'))
    expect(endRulesEntry).toBeDefined()

    const mainIndex = allEntries.findIndex((e: any) => e.id === mainEntry?.id)
    const endRulesIndex = allEntries.findIndex((e: any) => e.id === endRulesEntry?.id)
    // main is placed after 🛡️准则结束
    expect(mainIndex).toBeGreaterThan(endRulesIndex)

    // Check Pre-Chat variables
    const varsEntry = allEntries.find((e: any) => e.label.includes('🛡️ 变量'))
    expect(varsEntry).toBeDefined()
    const varsIndex = allEntries.findIndex((e: any) => e.id === varsEntry?.id)
    expect(varsIndex).toBeLessThan(mainIndex)

    // Check in-place anchor position: @setting.stable should be placed after varsEntry and before endRulesEntry
    const stableAnchor = allEntries.find((e: any) => e.capabilities?.targetAnchorId === '@setting.stable')
    expect(stableAnchor).toBeDefined()
    const stableIndex = allEntries.findIndex((e: any) => e.id === stableAnchor?.id)
    expect(stableIndex).toBeGreaterThan(varsIndex)
    expect(stableIndex).toBeLessThan(endRulesIndex)

    // Verify localDepth is strictly increasing in each block
    for (const block of rootChildren) {
      if (!block.children || block.children.length <= 1) continue
      for (let i = 1; i < block.children.length; i++) {
        const prevDepth = block.children[i - 1]?.capabilities?.localDepth ?? 0
        const currDepth = block.children[i]?.capabilities?.localDepth ?? 0
        expect(currDepth).toBeGreaterThan(prevDepth)
      }
    }

    // Ensure orphan prompts not in prompt_order (such as R1-0528) are NOT imported
    const r1OrphanEntry = allEntries.find((e: any) => e.label.includes('R1-0528'))
    expect(r1OrphanEntry).toBeUndefined()

    // Ensure disabled entries within prompt_order (such as 短思考) ARE imported with enabled: false
    const disabledOrderEntry = allEntries.find((e: any) => e.label.includes('短思考'))
    expect(disabledOrderEntry).toBeDefined()
    expect(disabledOrderEntry?.enabled).toBe(false)
  })

  it('correctly normalizes real Rimworld lorebook with natural order and non-at_depth anchors', () => {
    const lorebookPath = join(__dirname, '../../extensions/sillytavern-importer/-----rimworld_ 库.json')
    if (!existsSync(lorebookPath)) return

    const rawJson = readFileSync(lorebookPath, 'utf8')
    const result = convertSillyTavernLorebook(rawJson, 'Rimworld 库')
    expect(result.artifact.format).toBe('loom.promptResource')
    expect(result.artifact.resourceKind).toBe('setting')

    const children = result.artifact.rootNode.children ?? []
    expect(children.length).toBeGreaterThan(10)

    // Check that entries are sorted by natural order (smaller order first)
    // Entry with order 100 should come before order 300
    const order100Entry = children.find((c: any) => c.label.includes('萌螈功法设定'))
    const order300Entry = children.find((c: any) => c.label.includes('温带森林'))
    expect(order100Entry).toBeDefined()
    expect(order300Entry).toBeDefined()

    const idx100 = children.findIndex((c: any) => c.id === order100Entry?.id)
    const idx300 = children.findIndex((c: any) => c.id === order300Entry?.id)
    expect(idx100).toBeLessThan(idx300)

    // Position is 0, so even though depth is 4 in raw JSON, it must NOT be @chat.session.post
    expect(order100Entry?.capabilities?.targetAnchorId).toBe('@setting.lower')
    expect(order300Entry?.capabilities?.targetAnchorId).toBe('@setting.lower')

    // Verify localDepths are positive and strictly increasing
    for (let i = 1; i < children.length; i++) {
      const prev = children[i - 1]?.capabilities?.localDepth ?? 0
      const curr = children[i]?.capabilities?.localDepth ?? 0
      expect(curr).toBeGreaterThan(prev)
    }
  })
})
