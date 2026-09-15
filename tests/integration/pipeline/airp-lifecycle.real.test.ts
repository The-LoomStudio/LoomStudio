import { describe, expect, it } from 'vitest'
import {
  createAgentStore,
  createNarrativeStore,
  createPromptResourceStore,
} from '@loom-studio/application-data'
import {
  createAgentToolRegistry,
  createApplicationRuntime,
  type ToolRuntimeRegistration,
} from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { officialFakeModelId } from '@loom-studio/ai-gateway'

function createRealRuntime() {
  let sequence = 0
  const createId = (prefix: string) => `${prefix}-${++sequence}`
  const now = () => new Date().toISOString()

  const engine = createSqliteDataEngine({
    filename: ':memory:',
    createId,
    now,
  })
  const documents = createSqliteDocumentStore({ engine })
  const agents = createAgentStore({ engine, createId, now })
  const narratives = createNarrativeStore({ engine, createId, now })
  const promptResources = createPromptResourceStore({ engine, createId, now })

  const agentTools = createAgentToolRegistry([])

  const runtime = createApplicationRuntime({
    agents,
    agentTools,
    dataEngine: engine,
    documents,
    narratives,
    promptResources,
  })

  return { engine, documents, runtime, agentTools }
}

describe('AIRP real-line pipeline integration', () => {
  it('executes a complete end-to-end cycle: Card -> Preset -> Session -> PromptBuild -> Agent Turn -> Timeline Commit', async () => {
    const { engine, runtime } = createRealRuntime()
    try {
      // 1. 创建 Card 实体
      const cardResult = await runtime.createCard({
        name: '雾港守望者',
        opening: '夜幕降临，雾港的灯塔亮起。',
        description: '一名守护海雾灯塔的守望者。',
      })
      const cardId = cardResult.card.id
      expect(cardId).toBeDefined()

      // 2. 构造 Preset 有序树（包含系统设定、角色设定、知识条目）
      const presetResource = await runtime.createPromptResource({
        resourceKind: 'preset',
        name: '守望者核心预设',
      })
      const rootNodeId = presetResource.resource.rootNode.id

      // 插入角色设定条目
      const personaAsset = await runtime.createPromptResourceAsset({
        resourceId: presetResource.resource.id,
        targetAssetId: rootNodeId,
        position: 'inside',
        asset: {
          id: 'preset.persona',
          label: '角色人设',
          category: 'preset',
          kind: 'entry',
          body: '你是一名忠于职守、冷静沉稳的灯塔看守人。对陌生人保持适度警惕。',
        },
      })
      expect(personaAsset.resource.version).toBeGreaterThanOrEqual(1)

      // 3. 配置 Provider Profile 与 Agent Profile
      const provider = await runtime.createProviderProfile({
        providerExtensionId: 'official.fake',
        displayName: 'Mock AI Gateway',
        config: {},
        enabledModelIds: [officialFakeModelId],
      })

      const profileResult = await runtime.createAgentProfile({
        name: '守望者 Agent',
        presetId: presetResource.resource.id,
        model: {
          providerProfileId: provider.providerProfile.id,
          modelId: officialFakeModelId,
        },
      })
      const profileId = profileResult.agentProfile.id

      // 4. 创建 Narrative 时间线会话
      const timelineResult = await runtime.createNarrativeTimeline({ cardId })
      const timelineId = timelineResult.timeline.id

      const sessionResult = await runtime.createAgentSession({
        agentProfileId: profileId,
        timelineId,
      })
      const sessionId = sessionResult.session.id

      // 5. 触发 PromptBuild 预检，验证有序树在上下文中的正确 DFS 组装
      const preview = await runtime.previewAgentTurn({
        agentSessionId: sessionId,
        input: '你好，请问灯塔几点熄灯？',
      })

      const promptSerialized = JSON.stringify(preview.projection.messages)
      // 必须包含开场白
      expect(promptSerialized).toContain('夜幕降临，雾港的灯塔亮起。')
      // 必须包含 Preset 注入的人设
      expect(promptSerialized).toContain('你是一名忠于职守、冷静沉稳的灯塔看守人')
      // 必须包含用户输入的 query
      expect(promptSerialized).toContain('你好，请问灯塔几点熄灯？')

      // 6. 执行真实的 Agent Turn（模拟端到端调用并落库时间线）
      const turnResult = await runtime.invokeAgentTurn({
        agentSessionId: sessionId,
        input: '你好，请问灯塔几点熄灯？',
        narrativeTarget: {
          timelineId,
          commit: true,
        },
      })

      expect(turnResult.agentSession.id).toBe(sessionId)
      // 校验提交产生的 Narrative 节点
      expect(turnResult.narrative).toBeDefined()
      expect(turnResult.narrative?.nodes.length).toBeGreaterThan(0)

      // 7. 直接下潜到 SQLite 数据库层，验证持久化 Fact 与节点行
      const timelineNodes = engine.database.prepare(
        'SELECT COUNT(*) as count FROM narrative_nodes WHERE timeline_id = ?',
      ).get(timelineId) as { count: number }
      // 开场白节点 + 用户输入节点 + 助手回复节点 >= 2
      expect(timelineNodes.count).toBeGreaterThanOrEqual(2)

      // 8. 验证状态迁移与会话持久性
      const timelineAfter = await runtime.getNarrativeTimeline({ timelineId })
      expect(timelineAfter.timeline.id).toBe(timelineId)
      expect(timelineAfter.branches.length).toBeGreaterThan(0)
      const page = await runtime.getNarrativePage({
        timelineId,
        branchId: timelineAfter.timeline.activeBranchId,
      })
      expect(page.nodes.length).toBe(timelineNodes.count)
    } finally {
      engine.close()
    }
  })
})
