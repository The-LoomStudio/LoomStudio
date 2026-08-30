import { describe, expect, it } from 'vitest'
import {
  compileToolPromptSources,
  type ToolPromptSource,
} from '../../../packages/application-runtime/src/agent/tool-prompt-build.js'
import type { ToolDefinition } from '../../../packages/application-runtime/src/agent/tool-registry.js'
import { createVariableRenderContext } from '../../../packages/application-runtime/src/variables.js'

const structuredTool: ToolDefinition = {
  id: 'official/read_context',
  owner: { namespace: 'official' },
  name: 'read_context',
  description: 'The structural definition description.',
  input: {
    kind: 'structured',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The query.' },
      },
      required: ['query'],
      enum: ['not-a-real-schema-field'],
    },
  },
}

const contentTool: ToolDefinition = {
  id: 'extension/render_document',
  owner: { namespace: 'extension' },
  name: 'render_document',
  description: 'Render a document.',
  input: {
    kind: 'hybrid',
    metadataSchema: {
      type: 'object',
      properties: { mode: { type: 'string', enum: ['preview'] } },
      required: ['mode'],
    },
    rawField: 'content',
    mediaType: 'text/plain',
  },
}

function source(
  tool: ToolDefinition,
  overrides: Partial<ToolPromptSource> = {},
): ToolPromptSource {
  return {
    tool,
    template: {
      description: `Use {{User}} to operate ${tool.name}.`,
      parameterDescriptions: { query: 'Ask {{User}} for the query.' },
      guidance: 'Only return results for {{User}}.',
    },
    transport: tool.input.kind === 'structured' ? 'native-function' : 'content',
    ...overrides,
  }
}

describe('Tool Prompt Compiler', () => {
  it('expands User macros only in model-visible template text', () => {
    const result = compileToolPromptSources({
      sources: [source(structuredTool)],
      variables: createVariableRenderContext({ global: { user: { name: 'Mio' } } }),
    })

    expect(result.exposures[0]).toMatchObject({
      toolId: structuredTool.id,
      name: structuredTool.name,
      transport: 'native-function',
      prompt: {
        description: 'Use Mio to operate read_context.',
        parameterDescriptions: { query: 'Ask Mio for the query.' },
        guidance: 'Only return results for Mio.',
      },
    })
    expect(result.exposures[0]?.input).toEqual(structuredTool.input)
    expect(result.exposures[0]?.prompt.description).not.toContain('{{User}}')
    expect(result.trace.orders).toEqual([
      {
        toolId: structuredTool.id,
        requestedIndex: 0,
        effectiveIndex: 0,
        projection: 'provider-tools',
      },
    ])
  })

  it('excludes inactive tools while tracing activation facts', () => {
    const result = compileToolPromptSources({
      sources: [
        source(structuredTool, {
          activation: { kind: 'keyword', keywords: ['weather'] },
        }),
        source(contentTool, {
          activation: { kind: 'condition', conditions: [{ fact: 'mode', equals: 'preview' }] },
        }),
      ],
      variables: createVariableRenderContext(),
      currentInput: 'show weather',
      activationFacts: { mode: 'draft' },
    })

    expect(result.exposures.map(exposure => exposure.toolId)).toEqual([structuredTool.id])
    expect(result.trace.activations).toEqual([
      expect.objectContaining({ toolId: structuredTool.id, active: true }),
      expect.objectContaining({ toolId: contentTool.id, active: false, reason: 'activation: conditions not matched' }),
    ])
  })

  it('rejects duplicate active model-visible names', () => {
    expect(() => compileToolPromptSources({
      sources: [
        source(structuredTool),
        source({ ...contentTool, name: structuredTool.name }),
      ],
      variables: createVariableRenderContext(),
    })).toThrow('Agent tools expose duplicate model name read_context')
  })

  it('sorts provider tools by providerOrder and traces the provider projection', () => {
    const first = source(structuredTool, {
      providerOrder: 8,
      contentPlacement: { zone: 'tools', slot: 'ignored-content-slot' },
    })
    const second = source({ ...structuredTool, id: 'official/search', name: 'search' }, {
      providerOrder: 1,
    })
    const third = source({ ...structuredTool, id: 'official/list', name: 'list' }, {
      providerOrder: 3,
    })

    const result = compileToolPromptSources({
      sources: [first, second, third],
      variables: createVariableRenderContext(),
    })

    expect(result.trace.requestedOrder).toEqual([
      second.tool.id,
      third.tool.id,
      first.tool.id,
    ])
    expect(result.trace.effectiveOrder).toEqual([
      second.tool.id,
      third.tool.id,
      first.tool.id,
    ])
    expect(result.exposures.map(exposure => exposure.order)).toEqual([
      { requestedIndex: 0, effectiveIndex: 0 },
      { requestedIndex: 1, effectiveIndex: 1 },
      { requestedIndex: 2, effectiveIndex: 2 },
    ])
    expect(result.trace.orders).toEqual([
      {
        toolId: second.tool.id,
        requestedIndex: 0,
        effectiveIndex: 0,
        projection: 'provider-tools',
        providerOrder: 1,
      },
      {
        toolId: third.tool.id,
        requestedIndex: 1,
        effectiveIndex: 1,
        projection: 'provider-tools',
        providerOrder: 3,
      },
      {
        toolId: first.tool.id,
        requestedIndex: 2,
        effectiveIndex: 2,
        projection: 'provider-tools',
        providerOrder: 8,
      },
    ])
  })

  it('sorts content tools by content placement and traces the content projection', () => {
    const first = source(contentTool, {
      contentPlacement: { zone: 'context', slot: 'extension-z', rankKey: '99', orderHint: 99 },
    })
    const second = source({ ...contentTool, id: 'extension/slot_a', name: 'slot_a' }, {
      providerOrder: 999,
      contentPlacement: { zone: 'tools', slot: 'extension-a', rankKey: '10', orderHint: 1 },
    })
    const third = source({ ...contentTool, id: 'extension/slot_b', name: 'slot_b' }, {
      contentPlacement: { zone: 'tools', slot: 'extension-b', rankKey: '10', orderHint: 1 },
    })
    const fourth = source({ ...contentTool, id: 'extension/order_later', name: 'order_later' }, {
      contentPlacement: { zone: 'tools', slot: 'extension-a', rankKey: '10', orderHint: 2 },
    })
    const fifth = source({ ...contentTool, id: 'extension/rank_later', name: 'rank_later' }, {
      contentPlacement: { zone: 'tools', slot: 'extension-a', rankKey: '20', orderHint: 1 },
    })

    const result = compileToolPromptSources({
      sources: [fifth, third, first, fourth, second],
      variables: createVariableRenderContext(),
    })

    expect(result.trace.requestedOrder).toEqual([
      first.tool.id,
      second.tool.id,
      third.tool.id,
      fourth.tool.id,
      fifth.tool.id,
    ])
    expect(result.trace.effectiveOrder).toEqual([
      first.tool.id,
      second.tool.id,
      third.tool.id,
      fourth.tool.id,
      fifth.tool.id,
    ])
    expect(result.trace.orders).toEqual([
      {
        toolId: first.tool.id,
        requestedIndex: 0,
        effectiveIndex: 0,
        projection: 'content-message',
        zone: 'context',
        slot: 'extension-z',
        rankKey: '99',
        orderHint: 99,
      },
      {
        toolId: second.tool.id,
        requestedIndex: 1,
        effectiveIndex: 1,
        projection: 'content-message',
        zone: 'tools',
        slot: 'extension-a',
        rankKey: '10',
        orderHint: 1,
      },
      {
        toolId: third.tool.id,
        requestedIndex: 2,
        effectiveIndex: 2,
        projection: 'content-message',
        zone: 'tools',
        slot: 'extension-b',
        rankKey: '10',
        orderHint: 1,
      },
      {
        toolId: fourth.tool.id,
        requestedIndex: 3,
        effectiveIndex: 3,
        projection: 'content-message',
        zone: 'tools',
        slot: 'extension-a',
        rankKey: '10',
        orderHint: 2,
      },
      {
        toolId: fifth.tool.id,
        requestedIndex: 4,
        effectiveIndex: 4,
        projection: 'content-message',
        zone: 'tools',
        slot: 'extension-a',
        rankKey: '20',
        orderHint: 1,
      },
    ])
  })

  it('preserves structural schema fields for native and content transports', () => {
    const structuredInput = structuredTool.input
    const contentInput = contentTool.input

    const result = compileToolPromptSources({
      sources: [
        source(structuredTool, {
          providerOrder: 1,
          transport: 'native-function',
        }),
        source(contentTool, {
          transport: 'provider-custom',
          providerOrder: 2,
        }),
      ],
      variables: createVariableRenderContext(),
    })

    expect(result.exposures[0]?.input).toEqual(structuredInput)
    expect(result.exposures[1]?.input).toEqual(contentInput)
    expect(result.exposures[0]?.input).not.toBe(structuredInput)
    expect(result.exposures[1]?.input).not.toBe(contentInput)
    expect(structuredTool.input).toEqual(structuredInput)
    expect(contentTool.input).toEqual(contentInput)
  })
})
