import { describe, expect, it } from 'vitest'
import { compilePromptDataModel } from '../../../packages/application-runtime/src/prompt/prompt-build-pipeline.js'
import { createOfficialPromptResourceContents } from '../../../packages/application-runtime/src/prompt/prompt-resource-defaults.js'

describe('Prompt Anchor System: @chat.session.post', () => {
  it('places @chat.session.post contributions into the post-session message when preset contains explicit anchor', () => {
    const resources = createOfficialPromptResourceContents('2026-09-04T00:00:00Z')
    const preset = resources.find(r => r.resourceKind === 'preset')!.rootNode
    const sourceNodes = [
      {
        id: preset.id,
        sourceId: 'preset-1',
        parentId: null,
        displayName: preset.label,
        orderIndex: 0,
        kind: 'module' as const,
      },
      ...preset.children!.flatMap((msg, msgIdx) => [
        {
          id: msg.id,
          sourceId: 'preset-1',
          parentId: preset.id,
          displayName: msg.label,
          orderIndex: msgIdx,
          kind: 'message' as const,
          capabilities: msg.capabilities,
        },
        ...msg.children!.map((child, childIdx) => ({
          id: child.id,
          sourceId: 'preset-1',
          parentId: msg.id,
          displayName: child.label,
          orderIndex: childIdx,
          kind: child.kind as 'entry' | 'virtual',
          capabilities: child.capabilities,
          body: child.body,
        })),
      ]),
    ]

    const activeContributions = [
      {
        id: 'session-msg-1',
        sourceRef: { kind: 'sessionHistory' as const, sourceId: 'session-1', sourceNodeId: 's1' },
        content: 'User: Hello\nAssistant: Hi there!',
        capabilities: { targetAnchorId: '@chat.session', localDepth: 1, roleHint: 'user' as const },
      },
      {
        id: 'lower-setting-1',
        sourceRef: { kind: 'settingLayer' as const, sourceId: 'setting-1', sourceNodeId: 'low1' },
        content: '[Dynamic Lore: Eldoria is raining today]',
        capabilities: { targetAnchorId: '@setting.lower', localDepth: 5, roleHint: 'system' as const },
      },
      {
        id: 'post-rule-2',
        sourceRef: { kind: 'settingLayer' as const, sourceId: 'setting-1', sourceNodeId: 'e2' },
        content: '[Output format requirement: keep concise]',
        capabilities: { targetAnchorId: '@chat.session.post', localDepth: 20, roleHint: 'system' as const },
      },
      {
        id: 'post-rule-1',
        sourceRef: { kind: 'settingLayer' as const, sourceId: 'setting-1', sourceNodeId: 'e1' },
        content: '[Do not break character]',
        capabilities: { targetAnchorId: '@chat.session.post', localDepth: 10, roleHint: 'system' as const },
      },
      {
        id: 'user-input-1',
        sourceRef: { kind: 'runtime' as const, sourceId: 'turn-1', sourceNodeId: 'u1' },
        content: 'What is the weather today?',
        capabilities: { targetAnchorId: '@chat.input', localDepth: 1, roleHint: 'user' as const },
      },
    ]

    const result = compilePromptDataModel({ sourceNodes, contributions: activeContributions })
    expect(result.messages.length).toBeGreaterThanOrEqual(4)

    // Find the session message, post-session message, and user input message
    const sessionMsg = result.messages.find(m => m.content.includes('User: Hello'))!
    const postSessionMsg = result.messages.find(m => m.content.includes('[Do not break character]'))!
    const userInputMsg = result.messages.find(m => m.content.includes('What is the weather today?'))!

    expect(sessionMsg).toBeDefined()
    expect(postSessionMsg).toBeDefined()
    expect(userInputMsg).toBeDefined()

    const sessionIdx = result.messages.indexOf(sessionMsg)
    const postSessionIdx = result.messages.indexOf(postSessionMsg)
    const userInputIdx = result.messages.indexOf(userInputMsg)

    // Strict ordering: session -> post-session -> user-input
    expect(sessionIdx).toBeLessThan(postSessionIdx)
    expect(postSessionIdx).toBeLessThan(userInputIdx)

    // Contains @setting.lower first, then sorted @chat.session.post entries
    expect(postSessionMsg.content).toBe('[Dynamic Lore: Eldoria is raining today]\n\n[Do not break character]\n\n[Output format requirement: keep concise]')
  })

  it('falls back to append @chat.session.post right after @chat.session when preset lacks explicit post-session node', () => {
    // Construct an older preset that only has @chat.session and @chat.input inside a single message
    const sourceNodes = [
      {
        id: 'old-preset-root',
        sourceId: 'preset-old',
        parentId: null,
        displayName: 'Old Preset',
        orderIndex: 0,
        kind: 'module' as const,
      },
      {
        id: 'msg-dialogue',
        sourceId: 'preset-old',
        parentId: 'old-preset-root',
        displayName: 'Dialogue Message',
        orderIndex: 0,
        kind: 'message' as const,
        capabilities: { roleHint: 'system' as const },
      },
      {
        id: 'virtual-session',
        sourceId: 'preset-old',
        parentId: 'msg-dialogue',
        displayName: '@chat.session',
        orderIndex: 0,
        kind: 'virtual' as const,
        capabilities: { targetAnchorId: '@chat.session' },
      },
      {
        id: 'virtual-input',
        sourceId: 'preset-old',
        parentId: 'msg-dialogue',
        displayName: '@chat.input',
        orderIndex: 1,
        kind: 'virtual' as const,
        capabilities: { targetAnchorId: '@chat.input' },
      },
    ]

    const activeContributions = [
      {
        id: 'session-content',
        sourceRef: { kind: 'sessionHistory' as const, sourceId: 'session-1', sourceNodeId: 's1' },
        content: 'Historical dialogue',
        capabilities: { targetAnchorId: '@chat.session', localDepth: 1, roleHint: 'user' as const },
      },
      {
        id: 'lower-setting-content',
        sourceRef: { kind: 'settingLayer' as const, sourceId: 'setting-1', sourceNodeId: 'low1' },
        content: 'Triggered dynamic lower setting entry',
        capabilities: { targetAnchorId: '@setting.lower', localDepth: 10, roleHint: 'system' as const },
      },
      {
        id: 'post-session-fallback',
        sourceRef: { kind: 'settingLayer' as const, sourceId: 'setting-1', sourceNodeId: 'p1' },
        content: 'Jailbreak post-session instruction',
        capabilities: { targetAnchorId: '@chat.session.post', localDepth: 10, roleHint: 'system' as const },
      },
      {
        id: 'user-input',
        sourceRef: { kind: 'runtime' as const, sourceId: 'turn-1', sourceNodeId: 'u1' },
        content: 'Current input',
        capabilities: { targetAnchorId: '@chat.input', localDepth: 1, roleHint: 'user' as const },
      },
    ]

    const result = compilePromptDataModel({ sourceNodes, contributions: activeContributions })
    expect(result.messages.length).toBe(1)
    const content = result.messages[0].content

    // In old preset fallback: Historical dialogue -> Triggered dynamic lower setting entry -> Jailbreak post-session instruction -> Current input
    const historyPos = content.indexOf('Historical dialogue')
    const lowerSettingPos = content.indexOf('Triggered dynamic lower setting entry')
    const fallbackPos = content.indexOf('Jailbreak post-session instruction')
    const inputPos = content.indexOf('Current input')

    expect(historyPos).toBeGreaterThanOrEqual(0)
    expect(lowerSettingPos).toBeGreaterThan(historyPos)
    expect(fallbackPos).toBeGreaterThan(lowerSettingPos)
    expect(inputPos).toBeGreaterThan(fallbackPos)
  })
})

