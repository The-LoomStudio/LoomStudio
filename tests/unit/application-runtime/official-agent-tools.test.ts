import {
  createOfficialTestAgentToolRegistry,
  officialTestContentTool,
  officialTestStructuredTool,
} from '@loom-studio/application-runtime'
import { describe, expect, it } from 'vitest'

describe('official Agent test tools', () => {
  it('exposes one structured and one hybrid content tool', () => {
    const registry = createOfficialTestAgentToolRegistry()
    expect(registry.list()).toEqual([
      officialTestStructuredTool,
      officialTestContentTool,
    ])
    expect(
      registry.analyze(
        [officialTestStructuredTool.id, officialTestContentTool.id],
        { nativeFunction: true, providerCustom: false, content: true },
      ).exposures,
    ).toEqual([
      expect.objectContaining({ transport: 'native-function' }),
      expect.objectContaining({ transport: 'content' }),
    ])
  })

  it('returns deterministic success and requested error results', async () => {
    const registry = createOfficialTestAgentToolRegistry()
    const signal = new AbortController().signal
    const structured = await registry.execute(
      {
        id: 'inv-structured',
        toolId: officialTestStructuredTool.id,
        arguments: { mode: 'success', value: 'hello' },
        transport: 'native-function',
      },
      signal,
    )
    const contentError = await registry.execute(
      {
        id: 'inv-content',
        toolId: officialTestContentTool.id,
        arguments: { mode: 'error', label: 'example' },
        rawInput: 'raw body',
        transport: 'content',
      },
      signal,
    )

    expect(structured).toMatchObject({
      status: 'completed',
      content: [
        {
          type: 'json',
          value: { kind: 'structured-test', value: 'hello' },
        },
      ],
    })
    expect(contentError).toMatchObject({
      status: 'failed',
      error: {
        code: 'tool.execution_failed',
        message: 'Content test tool failed as requested',
      },
    })
  })
})
