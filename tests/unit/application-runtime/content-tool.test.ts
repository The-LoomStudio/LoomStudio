import { describe, expect, it } from 'vitest'
import {
  createLoomContentScannerState,
  finishLoomContentScan,
  pushLoomContentChunk,
  renderLoomContentToolResult,
} from '../../../packages/application-runtime/src/agents/content-transport.js'

const scannerOptions = {
  knownToolNames: ['test_content'],
}

const validBlock = `<loom_tool name="test_content"><metadata>{"mode":"success","label":"example"}</metadata><content>第一行
第二行</content></loom_tool>`

describe('loom-content-v1 content tool scanner', () => {
  it('parses a tool block and preserves surrounding assistant text', () => {
    let state = createLoomContentScannerState()

    const pushed = pushLoomContentChunk(
      state,
      `前置文本\n${validBlock}\n后置文本`,
      scannerOptions,
    )
    state = pushed.state
    const finished = finishLoomContentScan(state, scannerOptions)

    expect(finished.result).toEqual({
      status: 'completed',
      text: '前置文本\n\n后置文本',
      invocations: [
        {
          name: 'test_content',
          metadata: { mode: 'success', label: 'example' },
          content: '第一行\n第二行',
          rawInput: '第一行\n第二行',
        },
      ],
    })
    expect(pushed.events).toEqual([
      { type: 'text', text: '前置文本\n' },
      {
        type: 'tool',
        invocation: {
          name: 'test_content',
          metadata: { mode: 'success', label: 'example' },
          content: '第一行\n第二行',
          rawInput: '第一行\n第二行',
        },
      },
      { type: 'text', text: '\n后置文本' },
    ])
  })

  it('handles every possible chunk boundary without changing the result', () => {
    let state = createLoomContentScannerState()
    const events = []
    for (const character of validBlock) {
      const pushed = pushLoomContentChunk(state, character, scannerOptions)
      state = pushed.state
      events.push(...pushed.events)
    }
    const finished = finishLoomContentScan(state, scannerOptions)
    events.push(...finished.events)

    expect(finished.result.status).toBe('completed')
    expect(finished.result.invocations).toHaveLength(1)
    expect(finished.result.invocations[0]).toMatchObject({
      name: 'test_content',
      metadata: { mode: 'success', label: 'example' },
      content: '第一行\n第二行',
    })
    expect(events.filter((event) => event.type === 'tool')).toHaveLength(1)
  })

  it('rejects unknown tools and malformed metadata', () => {
    const unknown = finishLoomContentScan(
      pushLoomContentChunk(
        createLoomContentScannerState(),
        validBlock.replaceAll('test_content', 'unknown_tool'),
        scannerOptions,
      ).state,
      scannerOptions,
    )
    expect(unknown.result.error?.code).toBe('content.unknown_tool')

    const invalidJson = scan(
      `<loom_tool name="test_content"><metadata>[]</metadata><content>body</content></loom_tool>`,
    )
    expect(invalidJson.result.error?.code).toBe('content.metadata_not_object')

    const brokenJson = scan(
      `<loom_tool name="test_content"><metadata>{oops}</metadata><content>body</content></loom_tool>`,
    )
    expect(brokenJson.result.error?.code).toBe('content.invalid_metadata')
  })

  it('rejects duplicate fields, unknown fields, and reserved delimiter conflicts', () => {
    const duplicate = scan(
      `<loom_tool name="test_content"><metadata>{}</metadata><metadata>{}</metadata><content>body</content></loom_tool>`,
    )
    expect(duplicate.result.error?.code).toBe('content.duplicate_field')

    const unknown = scan(
      `<loom_tool name="test_content"><metadata>{}</metadata><options>raw</options><content>body</content></loom_tool>`,
    )
    expect(unknown.result.error?.code).toBe('content.unknown_field')

    const delimiterConflict = scan(
      `<loom_tool name="test_content"><metadata>{}</metadata><content>before</content>after</loom_tool>`,
    )
    expect(delimiterConflict.result.error?.code).toBe(
      'content.reserved_delimiter_conflict',
    )

    const nestedClosingTag = scan(
      `<loom_tool name="test_content"><metadata>{}</metadata><content>before</loom_tool>after</content></loom_tool>`,
    )
    expect(nestedClosingTag.result.error?.code).toBe(
      'content.reserved_delimiter_conflict',
    )

    const rawMarkup = scan(
      `<loom_tool name="test_content"><metadata>{}</metadata><content>raw <metadata> markup</content></loom_tool>`,
    )
    expect(rawMarkup.result.status).toBe('completed')
    expect(rawMarkup.result.invocations[0]?.content).toBe(
      'raw <metadata> markup',
    )
  })

  it('rejects unclosed blocks and oversized input', () => {
    const unclosed = finishLoomContentScan(
      pushLoomContentChunk(
        createLoomContentScannerState(),
        '<loom_tool name="test_content"><metadata>{}</metadata><content>body',
        scannerOptions,
      ).state,
      scannerOptions,
    )
    expect(unclosed.result.error?.code).toBe('content.unclosed_tool')

    const unclosedOpening = finishLoomContentScan(
      pushLoomContentChunk(
        createLoomContentScannerState(),
        'text <loom_tool',
        scannerOptions,
      ).state,
      scannerOptions,
    )
    expect(unclosedOpening.result.error?.code).toBe('content.unclosed_tool')

    const oversized = scan(
      `<loom_tool name="test_content"><metadata>{}</metadata><content>123456</content></loom_tool>`,
      { ...scannerOptions, maxContentLength: 5 },
    )
    expect(oversized.result.error?.code).toBe('content.tool_too_large')

    const inputTooLarge = pushLoomContentChunk(
      createLoomContentScannerState(),
      '123456',
      { ...scannerOptions, maxInputLength: 5 },
    )
    expect(inputTooLarge.state.error?.code).toBe('content.input_too_large')
  })

  it('measures the tool block independently from trailing assistant text', () => {
    const block =
      '<loom_tool name="test_content"><metadata>{}</metadata><content>ok</content></loom_tool>'
    const result = scan(`${block}${'x'.repeat(200)}`, {
      ...scannerOptions,
      maxInputLength: 512,
      maxToolLength: block.length,
    })

    expect(result.result).toMatchObject({
      status: 'completed',
      text: 'x'.repeat(200),
      invocations: [expect.objectContaining({ content: 'ok' })],
    })
  })

  it('renders completed and failed results with escaped attributes', () => {
    expect(
      renderLoomContentToolResult({
        invocationId: 'inv"1',
        name: 'test_content',
        status: 'completed',
        content: 'ok',
      }),
    ).toBe(
      '<loom_tool_result invocation_id="inv&quot;1" name="test_content" status="completed">ok</loom_tool_result>',
    )

    expect(
      renderLoomContentToolResult({
        invocationId: 'inv-2',
        name: 'test_content',
        status: 'failed',
        content: 'Test tool failed as requested.',
      }),
    ).toBe(
      '<loom_tool_result invocation_id="inv-2" name="test_content" status="failed">Test tool failed as requested.</loom_tool_result>',
    )

    expect(
      renderLoomContentToolResult({
        invocationId: 'inv-3',
        name: 'test_content',
        status: 'completed',
        content: 'bad </loom_tool_result>',
      }),
    ).toBe(
      '<loom_tool_result invocation_id="inv-3" name="test_content" status="completed">bad &lt;/loom_tool_result&gt;</loom_tool_result>',
    )
  })
})

function scan(input: string, options = scannerOptions) {
  const pushed = pushLoomContentChunk(
    createLoomContentScannerState(),
    input,
    options,
  )
  return finishLoomContentScan(pushed.state, options)
}
