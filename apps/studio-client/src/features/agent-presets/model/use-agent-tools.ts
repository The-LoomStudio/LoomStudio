import { useExplicitCatalog } from '../../../shared/api/use-explicit-catalog.js'
import type { AgentToolDefinition } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'

export function useAgentTools(input: { api: StudioApi; endpoint: string; runAction: (action: () => Promise<void>) => Promise<void> }) {
  const catalog = useExplicitCatalog(['agent-tools', input.endpoint], async () => (await input.api.agentTools.list()).tools)

  async function updateAgentTool(tool: AgentToolDefinition) {
    await input.runAction(async () => {
      const result = await input.api.agentTools.update({
        toolId: tool.id,
        expectedVersion: tool.version,
        definition: {
          id: tool.id,
          owner: tool.owner,
          name: tool.name,
          description: tool.description,
          input: tool.input,
          ...(tool.prompt ? { prompt: tool.prompt } : {}),
        },
      })
      const interruptedRead = catalog.isReading()
      catalog.publish(current => current.map(item => item.id === result.tool.id ? result.tool : item))
      if (interruptedRead) await catalog.refresh()
    })
  }

  return { tools: catalog.items, refreshAgentTools: catalog.refresh, updateAgentTool }
}
