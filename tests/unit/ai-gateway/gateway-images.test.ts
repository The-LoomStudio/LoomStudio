import { describe, expect, it } from 'vitest'
import { createAiGateway } from '../../../packages/ai-gateway/src/index.js'

const image = {
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7XcAAAAASUVORK5CYII=',
  mediaType: 'image/png',
}

function captureFetch(requests: Array<Record<string, unknown>>, fail = false): typeof fetch {
  return (async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    return new Response(JSON.stringify(fail
      ? { error: { message: 'Images are not supported by this model', type: 'invalid_request_error' } }
      : { id: 'image-response', model: 'test-model', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'A picture' } }] }), {
      status: fail ? 400 : 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
}

describe('gateway image messages', () => {
  it.each(['Describe this picture', ''])('sends image bytes and preserves text %j through the SDK', async content => {
    const requests: Array<Record<string, unknown>> = []
    const result = await createAiGateway().invokeChat({
      provider: { kind: 'openai-compatible', apiKey: 'key', fetch: captureFetch(requests) },
      modelId: 'test-model',
      messages: [{ role: 'user', content, images: [image] }],
    })
    expect(result.text).toBe('A picture')
    expect(requests).toHaveLength(1)
    expect(requests[0]?.messages).toEqual([{
      role: 'user',
      content: [
        ...(content ? [{ type: 'text', text: content }] : []),
        { type: 'image_url', image_url: { url: `data:image/png;base64,${image.data}` } },
      ],
    }])
  })

  it('surfaces provider image rejection without retrying as text only', async () => {
    const requests: Array<Record<string, unknown>> = []
    const run = createAiGateway().createRun({
      provider: { kind: 'openai-compatible', apiKey: 'key', fetch: captureFetch(requests, true) },
      modelId: 'test-model',
      messages: [{ role: 'user', content: 'Describe', images: [image] }],
    })
    await expect(run.result).rejects.toThrow('Images are not supported by this model')
    expect(run.getState()).toBe('failed')
    expect(requests).toHaveLength(1)
    expect(requests[0]?.messages).toEqual([{
      role: 'user',
      content: [
        { type: 'text', text: 'Describe' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${image.data}` } },
      ],
    }])
  })
})
