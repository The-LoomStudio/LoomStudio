import { createAiGateway, type AiGatewayEvent } from '../../../packages/ai-gateway/src/index.js'
import { describe, expect, it } from 'vitest'

describe('AI gateway run', () => {
  it('uses the same run contract for a complete response', async () => {
    const run = createAiGateway().createRun({
      provider: provider(stubComplete('complete')),
      modelId: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
      delivery: 'complete',
    })

    await expect(run.result).resolves.toMatchObject({ text: 'complete', finishReason: 'stop' })
    expect((await collect(run.events)).map(event => event.type)).toEqual([
      'started',
      'usage',
      'completed',
    ])
  })

  it('normalizes streamed text and tool input deltas', async () => {
    const textRun = createAiGateway().createRun({
      provider: provider(stubSse([
        chunk({ choices: [{ index: 0, delta: { role: 'assistant', content: 'hel' }, finish_reason: null }] }),
        chunk({ choices: [{ index: 0, delta: { content: 'lo' }, finish_reason: null }] }),
        chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: usage() }),
        '[DONE]',
      ])),
      modelId: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
      delivery: 'stream',
    })
    await expect(textRun.result).resolves.toMatchObject({ text: 'hello' })
    expect((await collect(textRun.events)).filter(event => event.type === 'text-delta')).toEqual([
      expect.objectContaining({ delta: 'hel' }),
      expect.objectContaining({ delta: 'lo' }),
    ])

    const toolRun = createAiGateway().createRun({
      provider: provider(stubSse([
        chunk({ choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'write_text', arguments: '{"path":' } }] }, finish_reason: null }] }),
        chunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"a.txt"}' } }] }, finish_reason: null }] }),
        chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: usage() }),
        '[DONE]',
      ])),
      modelId: 'test-model',
      messages: [{ role: 'user', content: 'write' }],
      tools: [{ name: 'write_text', inputSchema: { type: 'object' } }],
      delivery: 'stream',
    })
    await expect(toolRun.result).resolves.toMatchObject({ finishReason: 'tool_call' })
    expect((await collect(toolRun.events)).filter(event => event.type === 'tool-input-delta')).toEqual([
      expect.objectContaining({ toolCallId: 'call-1', toolName: 'write_text', delta: '{"path":' }),
      expect.objectContaining({ toolCallId: 'call-1', toolName: 'write_text', delta: '"a.txt"}' }),
    ])
  })

  it('propagates cancellation to the provider AbortSignal', async () => {
    let providerSignal: AbortSignal | undefined
    let markProviderStarted!: () => void
    const providerStarted = new Promise<void>(resolve => { markProviderStarted = resolve })
    const run = createAiGateway().createRun({
      provider: provider((async (_url, init) => {
        providerSignal = init?.signal ?? undefined
        markProviderStarted()
        return await new Promise<Response>((_resolve, reject) => {
          if (providerSignal?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
          providerSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
        })
      }) as typeof fetch),
      modelId: 'test-model',
      messages: [{ role: 'user', content: 'wait' }],
      delivery: 'stream',
    })

    await providerStarted
    run.cancel('user-stop')
    await expect(run.result).rejects.toMatchObject({ name: 'AbortError' })
    expect(providerSignal?.aborted).toBe(true)
    const events = await collect(run.events)
    expect(events.filter(isTerminal)).toEqual([expect.objectContaining({ type: 'cancelled', reason: 'user-stop' })])
  })

  it('preserves an external abort error message without emitting empty usage', async () => {
    const controller = new AbortController()
    const run = createAiGateway().createRun({
      provider: provider((async (_url, init) => await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })) as typeof fetch),
      modelId: 'test-model',
      messages: [{ role: 'user', content: 'wait' }],
      abortSignal: controller.signal,
      delivery: 'stream',
    })

    controller.abort(new Error('upstream-stop'))
    await expect(run.result).rejects.toMatchObject({ name: 'AbortError' })
    const events = await collect(run.events)
    expect(events.some(event => event.type === 'usage')).toBe(false)
    expect(events.filter(isTerminal)).toEqual([expect.objectContaining({ type: 'cancelled', reason: 'upstream-stop' })])
  })

  it('emits one failed terminal when a provider closes early after a delta', async () => {
    const run = createAiGateway().createRun({
      provider: provider(stubSse([
        chunk({ choices: [{ index: 0, delta: { role: 'assistant', content: 'partial' }, finish_reason: null }] }),
      ])),
      modelId: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
      delivery: 'stream',
    })

    await expect(run.result).rejects.toThrow()
    const events = await collect(run.events)
    expect(events.filter(event => event.type === 'text-delta')).toHaveLength(1)
    expect(events.filter(isTerminal)).toEqual([expect.objectContaining({ type: 'failed' })])
  })
})

function provider(fetch: typeof globalThis.fetch) {
  return { kind: 'openai-compatible' as const, apiKey: 'test-key', baseUrl: 'https://example.test/v1', fetch }
}

function stubComplete(content: string): typeof fetch {
  return (async () => new Response(JSON.stringify({
    id: 'call-complete',
    model: 'test-model',
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }],
    usage: usage(),
  }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch
}

function stubSse(items: string[]): typeof fetch {
  return (async () => new Response(new ReadableStream({
    start(controller) {
      for (const item of items) controller.enqueue(new TextEncoder().encode(`data: ${item}\n\n`))
      controller.close()
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } })) as typeof fetch
}

function chunk(input: Record<string, unknown>): string {
  return JSON.stringify({ id: 'chatcmpl-stream', object: 'chat.completion.chunk', created: 1, model: 'test-model', ...input })
}

function usage() {
  return { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 }
}

async function collect(events: AsyncIterable<AiGatewayEvent>): Promise<AiGatewayEvent[]> {
  const values: AiGatewayEvent[] = []
  for await (const event of events) values.push(event)
  return values
}

function isTerminal(event: AiGatewayEvent): boolean {
  return event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled'
}
