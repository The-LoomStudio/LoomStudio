import { createApplicationRuntime } from '@loom-studio/application-runtime'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { describe, expect, it } from 'vitest'

describe('application runtime prompt preview integration', () => {
  it('previews the same prompt builder messages that submitTurn stores in the run', async () => {
    const runtime = createApplicationRuntime({
      documents: createInMemoryDocumentStore(),
    })
    const card = await runtime.createCard({
      name: 'Prompt Card',
      description: '用于测试 Prompt Builder 闭环。',
      opening: {
        entries: [
          { role: 'assistant', content: '开场正文。' },
        ],
      },
      settingLayer: {
        entries: [
          {
            title: 'Always On',
            content: '总是注入的设定。',
            activation: { kind: 'always' },
          },
          {
            title: 'Rain Keyword',
            content: '只有提到雨才注入。',
            activation: { kind: 'keyword', keywords: ['雨'] },
          },
          {
            title: 'Manual Only',
            content: '手动设定暂不自动注入。',
            activation: { kind: 'manual' },
          },
        ],
      },
    })
    const { session, branch } = await runtime.createSessionFromCard({ cardId: card.card.id })
    const preview = await runtime.previewPrompt({
      sessionId: session.id,
      branchId: branch.id,
      input: '我听见雨落在窗外。',
    })
    const turn = await runtime.submitTurn({
      sessionId: session.id,
      branchId: branch.id,
      input: '我听见雨落在窗外。',
    })
    const run = await runtime.getRun({ runId: turn.run.id })
    const storedPrompt = run.runtimeEntries.find(entry => entry.kind === 'prompt')?.content as { messages?: unknown }

    expect(preview.messages).toEqual([
      expect.objectContaining({ role: 'system', content: expect.stringContaining('Prompt Card') }),
      expect.objectContaining({ role: 'system', content: expect.stringContaining('Always On: 总是注入的设定。') }),
      { role: 'assistant', content: '开场正文。' },
      { role: 'user', content: '我听见雨落在窗外。' },
    ])
    expect(preview.messages).toEqual(preview.projection.messages)
    expect(preview.messages[0]?.content).toContain('Card description: 用于测试 Prompt Builder 闭环。')
    expect(preview.messages[1]?.content).toContain('Always On: 总是注入的设定。')
    expect(preview.messages[1]?.content).toContain('Rain Keyword: 只有提到雨才注入。')
    expect(preview.messages.map(message => message.content).join('\n')).not.toContain('Manual Only')
    expect(storedPrompt.messages).toEqual(preview.messages)
  })

  it('applies projection order profile ranks to preview projection slots', async () => {
    const runtime = createApplicationRuntime({
      documents: createInMemoryDocumentStore(),
    })
    const card = await runtime.createCard({
      name: 'Projection Profile Card',
      preset: {
        system: '系统提示。',
      },
      settingLayer: {
        entries: [
          {
            title: 'Stable Setting',
            content: '稳定设定。',
            activation: { kind: 'always' },
          },
        ],
      },
    })
    const { session, branch } = await runtime.createSessionFromCard({ cardId: card.card.id })
    const preview = await runtime.previewPrompt({
      sessionId: session.id,
      branchId: branch.id,
      input: '我检查排序。',
      projectionOrderProfile: {
        id: 'profile.test',
        scope: 'session',
        slotRanks: [
          {
            zoneId: 'setting.stable',
            slotKey: 'setting-layer:m0-card-setting-layer@setting.stable',
            rankKey: '0000',
          },
          {
            zoneId: 'preset.system',
            slotKey: 'preset:m0-card-preset@preset.system',
            rankKey: '0001',
          },
        ],
      },
    })
    const presetSystem = preview.projection.zones.find(zone => zone.zoneId === 'preset.system')
    const stableSetting = preview.projection.zones.find(zone => zone.zoneId === 'setting.stable')

    expect(presetSystem?.slots.map(slot => slot.slotKey)).toEqual([
      'preset:m0-card-preset@preset.system',
    ])
    expect(stableSetting?.slots.map(slot => slot.slotKey)).toEqual([
      'setting-layer:m0-card-setting-layer@setting.stable',
    ])
    expect(presetSystem?.slots.map(slot => slot.orderSource)).toEqual(['rank'])
    expect(stableSetting?.slots.map(slot => slot.orderSource)).toEqual(['rank'])
    expect(preview.messages.map(message => message.content)).toEqual([
      expect.stringContaining('系统提示。'),
      'Stable Setting: 稳定设定。',
      '我检查排序。',
    ])
  })

  it('expands simple card {{User}} macros in preset, setting layer, and opening chat', async () => {
    const runtime = createApplicationRuntime({
      documents: createInMemoryDocumentStore(),
    })
    const card = await runtime.createCard({
      name: 'Macro Card',
      userName: '旅人',
      description: '{{User}}进入雾港。',
      preset: {
        system: '玩家名是 {{User}}。保持第二人称叙事。',
      },
      opening: {
        entries: [
          { role: 'assistant', content: '{{User}}推开旅馆的门。' },
        ],
      },
      settingLayer: {
        entries: [
          {
            title: '{{User}}当前场景',
            content: '{{User}}站在潮湿的柜台前。',
            activation: { kind: 'always' },
          },
        ],
      },
    })
    const { session, branch } = await runtime.createSessionFromCard({ cardId: card.card.id })
    const timeline = await runtime.getTimeline({ sessionId: session.id, branchId: branch.id })
    const preview = await runtime.previewPrompt({
      sessionId: session.id,
      branchId: branch.id,
      input: '我按下柜台铃。',
    })

    expect(session.cardSnapshot).toMatchObject({
      userName: '旅人',
      preset: { system: '玩家名是 {{User}}。保持第二人称叙事。' },
    })
    expect(timeline.entries.map(entry => entry.content)).toEqual(['旅人推开旅馆的门。'])
    expect(preview.messages[0]?.content).toContain('玩家名是 旅人。保持第二人称叙事。')
    expect(preview.messages[0]?.content).toContain('Card description: 旅人进入雾港。')
    expect(preview.messages[1]?.content).toContain('旅人当前场景: 旅人站在潮湿的柜台前。')
  })

  it('previews and stores the OpenAI-compatible provider payload for a selected model profile', async () => {
    const documents = createInMemoryDocumentStore()
    const runtime = createApplicationRuntime({
      documents,
      gateway: {
        invokeChat: async () => ({
          provider: 'fake',
          model: 'fake-payload-test',
          text: 'Payload trace response.',
        }),
      },
    })
    const providerAccount = await runtime.createProviderAccount({
      providerExtensionId: 'official.openai-compatible',
      displayName: 'OpenAI Compatible',
      config: { baseUrl: 'https://gateway.test/v1' },
      secretRefs: { apiKey: 'plain:test-key' },
    })
    const modelProfile = await runtime.createModelProfile({
      providerAccountId: providerAccount.providerAccount.id,
      displayName: 'Preview Model',
      providerModelId: 'preview-model',
      config: { temperature: 0.4, max_tokens: 128 },
    })
    const agentRuntimeProfile = await runtime.createAgentRuntimeProfile({
      name: 'Preview Agent',
      modelProfileId: modelProfile.modelProfile.id,
    })
    const { session, branch } = await runtime.createSession({
      cardSourceVersionId: 'card-version-1',
      cardSnapshot: { name: 'Payload Preview Card' },
      agentRuntimeProfileId: agentRuntimeProfile.agentRuntimeProfile.id,
    })
    const preview = await runtime.previewPrompt({
      sessionId: session.id,
      branchId: branch.id,
      input: '生成 payload。',
    })
    const turn = await runtime.submitTurn({
      sessionId: session.id,
      branchId: branch.id,
      input: '生成 payload。',
    })
    const run = await runtime.getRun({ runId: turn.run.id })
    const storedPrompt = run.runtimeEntries.find(entry => entry.kind === 'prompt')?.content as {
      promptBuildTrace?: {
        executions?: Array<{ passName?: string }>
        status?: string
      }
      providerPayloadPreview?: unknown
    }

    expect(preview.promptBuildTrace).toMatchObject({
      status: 'ok',
      executions: [
        expect.objectContaining({ passName: 'prompt.source.prepared' }),
        expect.objectContaining({ passName: 'prompt.compile' }),
      ],
    })
    expect(storedPrompt.promptBuildTrace).toMatchObject({
      status: 'ok',
      executions: [
        expect.objectContaining({ passName: 'prompt.source.prepared' }),
        expect.objectContaining({ passName: 'prompt.compile' }),
      ],
    })
    expect(preview.providerPayloadPreview).toMatchObject({
      model: 'preview-model',
      temperature: 0.4,
      max_tokens: 128,
      stream: false,
      messages: preview.messages,
    })
    expect(storedPrompt.providerPayloadPreview).toEqual(preview.providerPayloadPreview)
  })
})
