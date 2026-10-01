import { describe, expect, it, vi } from 'vitest'
import { createAgentStore } from '@loom-studio/application-data'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createAgentToolRegistry, type GatewayChatResult } from '@loom-studio/application-runtime'
import { runNativeToolLoop } from '../../../packages/application-runtime/src/agents/tool-loop.js'

async function fixture(reply: () => Promise<GatewayChatResult>) {
  let sequence = 0
  const createId = (prefix: string) => `${prefix}-${++sequence}`
  const now = () => '2026-10-01T00:00:00.000Z'
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const agents = createAgentStore({ engine, createId, now })
  const { session } = await agents.createSession({
    agentPresetId: 'preset', actor: { kind: 'system', id: 'test' },
  })
  const gateway = { invokeChat: vi.fn(reply) }
  const input = {
    ctx: { gateway, createId, agentTools: createAgentToolRegistry([], []) },
    agents, session, runId: 'run',
    model: { providerProfileId: 'provider', modelId: 'model' },
    initialMessages: [{ role: 'user' as const, content: 'Hello 世界' }],
    userInput: 'Hello 世界', branchId: 'agent-only', purpose: 'agent' as const, tokenMultiplier: 0.6,
    compiledToolSet: { tools: [], trace: { sourceCount: 0, activeCount: 0, requestedOrder: [], effectiveOrder: [], activations: [], orders: [] } },
  }
  return { engine, agents, session, input, gateway }
}

describe('request measurement failure boundaries', () => {
  it('saves known usage before malformed tool arguments can fail', async () => {
    const f = await fixture(async () => ({
      provider: 'provider', model: 'model', text: '', usage: { inputTokens: 20, outputTokens: 3, cacheReadTokens: 10, reasoningTokens: 2 },
      message: { role: 'assistant', tool_calls: [{ id: 'bad', type: 'function', function: { name: 'read', arguments: 'not json' } }] },
    }))
    try {
      await expect(runNativeToolLoop(f.input)).rejects.toThrow()
      const { entries } = await f.agents.getEntryPage({ agentSessionId: f.session.id })
      const measurement = entries.find(entry => entry.entry.kind === 'request-measurement')!.entry
      const observation = entries.find(entry => entry.entry.kind === 'provider-observation')!.entry
      expect(measurement).toMatchObject({ count: { basis: { multiplier: 0.6 } } })
      expect(observation).toMatchObject({ measurementId: measurement.kind === 'request-measurement' && measurement.measurementId, usage: { cacheReadTokens: 10, reasoningTokens: 2 } })
      expect(entries.at(-1)?.entry).toMatchObject({ kind: 'run-state', state: 'failed' })
    } finally { f.engine.close() }
  })
  it('does not call the provider when measurement persistence fails', async () => {
    const f = await fixture(async () => ({ provider: 'provider', model: 'model', text: 'ok', message: { role: 'assistant', content: 'ok' } }))
    try {
      const agents = {
        ...f.agents,
        appendEntries: async (input: Parameters<typeof f.agents.appendEntries>[0]) => {
          if (input.entries.some(entry => entry.entry.kind === 'request-measurement')) throw new Error('audit-write-failed')
          return f.agents.appendEntries(input)
        },
      }
      await expect(runNativeToolLoop({ ...f.input, agents })).rejects.toThrow('audit-write-failed')
      expect(f.gateway.invokeChat).not.toHaveBeenCalled()
    } finally { f.engine.close() }
  })
  it('rechecks cancellation after measurement persistence and never fabricates usage', async () => {
    const f = await fixture(async () => ({ provider: 'provider', model: 'model', text: 'ok', message: { role: 'assistant', content: 'ok' } }))
    const abort = new AbortController()
    try {
      const agents = {
        ...f.agents,
        appendEntries: async (input: Parameters<typeof f.agents.appendEntries>[0]) => {
          const result = await f.agents.appendEntries(input)
          if (input.entries.some(entry => entry.entry.kind === 'request-measurement')) abort.abort()
          return result
        },
      }
      await expect(runNativeToolLoop({ ...f.input, agents, requestContext: { abortSignal: abort.signal } })).rejects.toMatchObject({ name: 'AbortError' })
      expect(f.gateway.invokeChat).not.toHaveBeenCalled()
      const { entries } = await f.agents.getEntryPage({ agentSessionId: f.session.id })
      expect(entries.filter(entry => entry.entry.kind === 'request-measurement')).toHaveLength(1)
      expect(entries.some(entry => entry.entry.kind === 'provider-observation')).toBe(false)
    } finally { f.engine.close() }
  })
})
