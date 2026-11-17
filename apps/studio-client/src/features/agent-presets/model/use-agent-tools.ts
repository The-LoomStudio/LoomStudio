import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { subscribeDataCommits } from '../../../shared/api/data-commit-events.js'
import type { AgentToolDefinition } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'

const EMPTY_TOOLS: AgentToolDefinition[] = []

export function useAgentTools(input: { api: StudioApi; endpoint: string; runAction: (action: () => Promise<void>) => Promise<void> }) {
  const queryClient = useQueryClient()
  const queryKey = useMemo(() => ['agent-tools', input.endpoint] as const, [input.endpoint])
  const toolsQuery = useQuery({
    queryKey,
    queryFn: async () => (await input.api.agentTools.list()).tools,
  })

  useEffect(() => {
    return subscribeDataCommits(
      operations => {
        const hasToolChange = operations.some(op =>
          op.entityType === 'airp.agentTool'
          || op.scope?.entityType === 'airp.agentTool',
        )
        if (!hasToolChange) return
        void queryClient.invalidateQueries({ exact: true, queryKey })
      },
      () => {
        void queryClient.invalidateQueries({ exact: true, queryKey })
      },
    )
  }, [queryClient, queryKey])

  async function refreshAgentTools(): Promise<void> {
    const result = await toolsQuery.refetch()
    if (result.error) throw result.error
  }

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
      void queryClient.cancelQueries({ exact: true, queryKey })
      queryClient.setQueryData<AgentToolDefinition[]>(queryKey, current =>
        (current ?? []).map(item => item.id === result.tool.id ? result.tool : item),
      )
      await queryClient.invalidateQueries({ exact: true, queryKey })
    })
  }

  return { tools: toolsQuery.data ?? EMPTY_TOOLS, refreshAgentTools, updateAgentTool }
}
