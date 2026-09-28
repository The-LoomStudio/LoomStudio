import { describe, expect, it, vi } from 'vitest'
import { createOfficialAgentToolRegistry } from '../../../packages/application-runtime/src/agents/official-tools/index.js'
import { createCodeActContext } from '../../../packages/application-runtime/src/agents/codeact/context.js'
import { runCodeActSandbox } from '../../../packages/application-runtime/src/agents/codeact/sandbox.js'
import { codeActLimits } from '../../../packages/application-runtime/src/agents/codeact/protocol.js'
import type { ToolExecutionScope } from '../../../packages/application-runtime/src/agents/tool-registry.js'

const action = {
  kind: 'narrative-history-read' as const,
  timelineId: 'timeline', branchId: 'branch',
  selection: { kind: 'tail' as const, count: 1, throughNodeId: 'old' },
  maxNodes: 1, maxCharacters: 100,
}

describe('CodeAct history approval bridge', () => {
  it.each(['official/codeact', 'official/codeact_json'])('requires explicit host approval in %s', async toolId => {
    const registry = createOfficialAgentToolRegistry()
    const invocation = {
      id: 'read-old', toolId,
      ...(toolId.endsWith('_json')
        ? { arguments: { code: 'print((await ctx.readNarrative({selection:{kind:"tail",count:1}})).text)' } }
        : { rawInput: 'print((await ctx.readNarrative({selection:{kind:"tail",count:1}})).text)' }),
    }
    const scope: ToolExecutionScope = {
      context: [],
      narrative: {
        timelineId: 'timeline', branchId: 'branch',
        sample: async (_request, signal, approve) => {
          const decision = await approve!(action, signal)
          signal?.throwIfAborted()
          if (decision.decision !== 'allow') throw new Error('HISTORY_DENIED')
          return { timelineId: 'timeline', branchId: 'branch', nodes: [], text: 'OLD_BODY', complete: true }
        },
        appendNode: async () => ({ nodeId: 'unused' }),
        editNode: async () => ({ nodeId: 'unused' }),
      },
    }
    const signal = new AbortController().signal
    expect((await registry.execute(invocation, signal, scope)).status).toBe('failed')
    const requestApproval = vi.fn(async () => ({ decision: 'allow' as const }))
    scope.requestHistoryApproval = requestApproval
    const result = await registry.execute(invocation, signal, scope)
    expect(result.status).toBe('completed')
    expect(JSON.stringify(result.content)).toContain('OLD_BODY')
    expect(requestApproval).toHaveBeenCalledWith(action, expect.any(AbortSignal))
  })

  it('pauses only the approval wait budget passed by readNarrative', async () => {
    const context = createCodeActContext({
      context: [],
      narrative: {
        timelineId: 'timeline', branchId: 'branch',
        sample: async (_request, _signal, _approve, control) => {
          await control!.waitForUser(() => new Promise(resolve => setTimeout(resolve, 1800)))
          return { timelineId: 'timeline', branchId: 'branch', nodes: [], text: 'APPROVED', complete: true }
        },
        appendNode: async () => ({ nodeId: 'unused' }),
        editNode: async () => ({ nodeId: 'unused' }),
      },
    })
    const result = await runCodeActSandbox({
      source: 'print((await ctx.readNarrative({selection:{kind:"tail",count:1}})).text)',
      methods: context.methods, signal: new AbortController().signal,
      limits: { ...codeActLimits, timeoutMs: 1500 },
    })
    expect(result).toMatchObject({ status: 'completed', output: 'APPROVED' })
  })
})
