import { describe, expect, it } from 'vitest'
import { projectHistoryEntries, type TextTransformRuleEntry } from '../../packages/application-runtime/src/transforms/history-text.js'
import { convertSillyTavernRegexScripts, diagnoseSillyTavernRegexScripts } from '../../official/extensions/st-data-compat/src/normalizer/regex.js'
import { convertSillyTavernCard } from '../../official/extensions/st-data-compat/src/normalizer/card.js'
import { convertSillyTavernChat } from '../../official/extensions/st-data-compat/src/parser/chat.js'
import { prepareLoomMarkdown } from '../../apps/studio-client/src/shared/ui/markdown-content/markdown-content-model.js'
import { fingerprint } from '../../official/extensions/st-data-compat/src/client/index.js'
import { compatibleFileKind, normalizeScanPath } from '../../official/extensions/st-data-compat/src/client/index.js'

describe('SillyTavern compatibility', () => {
  it('maps native regex scripts without changing replacement semantics', () => {
    const rules = convertSillyTavernRegexScripts([{
      scriptName: 'State',
      findRegex: '/\\[state:(.*?)\\]/gi',
      replaceString: '<span>$1</span>',
      promptOnly: true,
      minDepth: 2,
      maxDepth: 4,
    }])

    expect(rules).toEqual([expect.objectContaining({
      name: 'State',
      enabled: true,
      orderIndex: 0,
      matcher: { kind: 'regex', pattern: '\\[state:(.*?)\\]', flags: 'gi' },
      effect: { kind: 'replace', replacement: '<span>$1</span>' },
      targets: ['narrative', 'agent-session'],
      phases: ['prompt'],
      range: { minDepth: 2, maxDepth: 4 },
    })])
  })

  it('maps ST placement 0 to display only and placement 1 to prompt only', () => {
    const rules = convertSillyTavernRegexScripts([
      { findRegex: '/display/', placement: [0] },
      { findRegex: '/prompt/', placement: [1] },
    ])

    expect(rules.map(rule => rule.phases)).toEqual([['display'], ['prompt']])
  })

  it('reports ST fields that cannot be represented by the native pipeline', () => {
    expect(diagnoseSillyTavernRegexScripts([{
      scriptName: 'Legacy',
      findRegex: '/x/',
      trimStrings: ['$1'],
      runOnEdit: true,
    }])).toEqual([
      'Legacy: trimStrings 无法在声明式 replacement 中逐捕获组等价映射',
      'Legacy: runOnEdit 被忽略，Loom 当前没有独立编辑阶段',
    ])
  })

  it('imports chat正文 while ignoring ST metadata and reasoning fields', () => {
    const result = convertSillyTavernChat([
      JSON.stringify({ chat_metadata: { chat_id: 'fixture' }, character_name: 'Bot' }),
      JSON.stringify({ is_user: true, mes: '第一行\n第二行', extra: { reasoning: 'ignore' } }),
      JSON.stringify({ is_system: true, mes: 'ignore system' }),
      JSON.stringify({ is_user: false, mes: '回复', swipes: ['备用回复'] }),
    ].join('\n'))

    expect(result.title).toBe('fixture')
    expect(result.messages).toEqual([
      { role: 'user', content: '第一行\n第二行' },
      { role: 'assistant', content: '回复' },
    ])
  })

  it('keeps prompt and display projections derived from immutable raw text', () => {
    const rule = {
      id: 'st-rule',
      version: 1,
      name: 'Replace marker',
      owner: { kind: 'preset', presetId: 'preset-1' },
      enabled: true,
      orderIndex: 0,
      matcher: { kind: 'regex', pattern: '\\[status\\]', flags: 'g' },
      effect: { kind: 'replace', replacement: 'READY' },
      targets: ['narrative', 'agent-session'],
      phases: ['prompt', 'display'],
      createdAt: '2026-09-13T00:00:00.000Z',
      updatedAt: '2026-09-13T00:00:00.000Z',
    } satisfies TextTransformRuleEntry
    const entries = [{
      id: 'node-1',
      source: { kind: 'narrative', timelineId: 'timeline-1', branchId: 'branch-1' },
      text: '原文 [status]',
      sequence: 0,
    }] as const

    const prompt = projectHistoryEntries({ source: entries[0].source, phase: 'prompt', entries: [...entries], rules: [rule] })
    const display = projectHistoryEntries({ source: entries[0].source, phase: 'display', entries: [...entries], rules: [rule] })
    const unloaded = projectHistoryEntries({ source: entries[0].source, phase: 'display', entries: [...entries], rules: [] })

    expect(prompt.entries[0]?.text).toBe('原文 READY')
    expect(display.entries[0]?.text).toBe('原文 READY')
    expect(unloaded.entries[0]?.text).toBe('原文 [status]')
    expect(entries[0].text).toBe('原文 [status]')
  })

  it('preserves ST opening line breaks through Loom Markdown preparation', () => {
    const opening = '第一行\n第二行\n\n第四行'
    expect(prepareLoomMarkdown(opening)).toBe(opening)
  })

  it('uses semantic fingerprints that ignore generated resource IDs', () => {
    expect(fingerprint({ id: 'one', label: 'World', children: [{ id: 'a', body: 'same' }] }))
      .toBe(fingerprint({ id: 'two', label: 'World', children: [{ id: 'b', body: 'same' }] }))
    expect(fingerprint({ label: 'World', body: 'different' }))
      .not.toBe(fingerprint({ label: 'World', body: 'same' }))
  })

  it('extracts embedded ST worldbooks as setting resources without losing their content', () => {
    const result = convertSillyTavernCard({
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: 'Embedded World',
        character_book: {
          name: 'Shared World',
          entries: {
            first: { uid: 1, keys: ['shared'], content: 'Shared entry', enabled: true },
          },
        },
      },
    })

    expect(result.artifact.contextAssets).toHaveLength(1)
    expect(result.artifact.contextAssets[0]).toMatchObject({
      category: 'setting',
      children: [{ body: 'Shared entry' }],
    })
  })

  it('limits bulk migration to compatible default-user directories', () => {
    expect(normalizeScanPath('Data/default-user/characters/Hero.png', true)).toBe('characters/Hero.png')
    expect(normalizeScanPath('Data/default-user/OpenAI Settings/Preset.json', true)).toBe('OpenAI Settings/Preset.json')
    expect(normalizeScanPath('Data/backups/characters/Hero.png', true)).toBe('')
    expect(compatibleFileKind('characters/Hero.png')).toBe('card')
    expect(compatibleFileKind('chats/Hero/chat.jsonl')).toBe('chat')
    expect(compatibleFileKind('worlds/World.json')).toBe('world')
    expect(compatibleFileKind('OpenAI Settings/Preset.json')).toBe('preset')
    expect(compatibleFileKind('settings.json')).toBeUndefined()
    expect(compatibleFileKind('backups/old.json')).toBeUndefined()
  })
})
