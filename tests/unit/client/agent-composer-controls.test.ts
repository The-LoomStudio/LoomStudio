import { afterEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement } from 'react'
import { AgentChatPanel, type AgentChatPanelProps } from '../../../apps/studio-client/src/widgets/agent-chat-panel/agent-chat-panel.js'
import { AgentComposer } from '../../../apps/studio-client/src/widgets/agent-composer/agent-composer.js'
import { ChatComposer } from '../../../apps/studio-client/src/widgets/chat-composer/chat-composer.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, vi.fn()],
  useRef: (current: unknown) => ({ current }),
  useEffect: () => undefined,
  useLayoutEffect: () => undefined,
  useMemo: (factory: () => unknown) => factory(),
}))

type Element = ReactElement<Record<string, unknown>>
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(value)) return []
  return [value, ...Object.values(value.props).flatMap(elements)]
}

function panelProps(): AgentChatPanelProps {
  return {
    runRecoveryBusy: false, canRestoreRunInput: false,
    reconnectAgentRun: vi.fn(async () => {}), restoreRunInput: vi.fn(),
    busy: false, input: '', profiles: [], providerAccounts: [], messages: [],
    t: createTranslator('en-US'), onChangeInput: vi.fn(), onSelectProfile: vi.fn(), onSubmit: vi.fn(),
    session: { id: 'session', agentPresetId: 'preset', title: 'Example', entryCount: 0, createdAt: '', updatedAt: '' },
    onDeleteSession: vi.fn(),
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('Agent composer controls', () => {
  it('does not show an unavailable preview action in Agent chat', () => {
    const composer = elements(AgentChatPanel(panelProps())).find(element => element.type === ChatComposer)!
    const buttons = elements(ChatComposer(composer.props as Parameters<typeof ChatComposer>[0]))
      .filter(element => element.type === 'button')
    expect(buttons.some(button => button.props.children === 'Preview')).toBe(false)
  })

  it('deletes only the current session after confirmation and disables deletion while busy', () => {
    const props = panelProps()
    const confirm = vi.fn(() => false)
    vi.stubGlobal('window', { confirm })
    const findDelete = (input: AgentChatPanelProps) => elements(AgentChatPanel(input))
      .find(element => element.type === 'button' && element.props['aria-label'] === 'Delete')!
    const button = findDelete(props)
    ;(button.props.onClick as () => void)()
    expect(props.onDeleteSession).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    ;(button.props.onClick as () => void)()
    expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('Example'))
    expect(props.onDeleteSession).toHaveBeenCalledWith('session')
    expect(findDelete({ ...props, busy: true }).props.disabled).toBe(true)
    expect(findDelete({ ...props, session: undefined }).props.disabled).toBe(true)
  })

  it('keeps Narrative visibility independent of the Agent panel, retaining pin behavior', () => {
    const props = {
      ...panelProps(), canPreviewPrompt: false, canSendNarrative: false,
      narrativeInput: '', narrativeTextareaDisabled: false, agentPanelOpen: true,
      onChangeNarrativeInput: vi.fn(), onPreviewPrompt: vi.fn(), onSubmitNarrative: vi.fn(),
    }
    const layer = (pinned: boolean) => elements(AgentComposer({ ...props, pinned }))
      .find(element => element.props['data-loom-object'] === 'agent-composer-layer')!
    expect(layer(false).props['data-active']).toBeUndefined()
    expect(layer(false).props['data-expanded']).toBeUndefined()
    expect(layer(true).props['data-active']).toBe('true')
  })
})
