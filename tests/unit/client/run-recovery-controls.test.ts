import { createElement, isValidElement, type FormEvent, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RunRecoveryControls, type RunRecoveryControlsProps } from '../../../apps/studio-client/src/features/narrative-runtime/ui/run-recovery-controls.js'
import { AgentComposer } from '../../../apps/studio-client/src/widgets/agent-composer/agent-composer.js'
import { AgentChatPanel, type AgentChatPanelProps } from '../../../apps/studio-client/src/widgets/agent-chat-panel/agent-chat-panel.js'
import { ChatComposer } from '../../../apps/studio-client/src/widgets/chat-composer/chat-composer.js'
import { InfoDialog } from '../../../apps/studio-client/src/shared/ui/info-dialog/info-dialog.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  memo: (component: unknown) => component,
  useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, vi.fn()],
  useRef: (current: unknown) => ({ current }),
  useEffect: () => undefined,
  useLayoutEffect: () => undefined,
  useMemo: (factory: () => unknown) => factory(),
}))

type Element = ReactElement<Record<string, unknown>>
vi.mock('../../../apps/studio-client/src/shared/ui/conversation-viewport/use-conversation-viewport.js', () => ({
  useConversationViewport: ({ items }: { items: { id: string }[] }) => ({
    smooth: { following: true, pause: vi.fn(), resume: vi.fn() },
    scrollRef: { current: null }, listRef: { current: null }, headerRef: { current: null },
    scrollMargin: 0, onScroll: vi.fn(),
    virtualizer: {
      getTotalSize: () => items.length * 280,
      getVirtualItems: () => items.map((item, index) => ({ key: item.id, index, start: index * 280 })),
      measureElement: vi.fn(),
    },
  }),
}))
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(value)) return []
  return [value, ...Object.values(value.props).flatMap(elements)]
}

function recoveryProps(overrides: Partial<RunRecoveryControlsProps> = {}): RunRecoveryControlsProps {
  return {
    runRecovery: { target: 'agent', status: 'disconnected' },
    runRecoveryBusy: false,
    canRestoreRunInput: false,
    reconnectAgentRun: vi.fn(async () => {}),
    restoreRunInput: vi.fn(),
    t: createTranslator('en-US'),
    ...overrides,
  }
}

describe('Run recovery controls', () => {
  it('shows a recoverable provider error as failure while keeping recovery actions', () => {
    const props = recoveryProps({ runRecovery: { target: 'agent', status: 'suspended', error: 'HTTP 404' }, abandonAgentRun: vi.fn(async () => {}) })
    const html = renderToStaticMarkup(createElement(RunRecoveryControls, props))
    expect(html).toContain('data-status="failed"')
    expect(html).toContain('role="alert"')
    const details = elements(RunRecoveryControls(props)).find(element => element.type === InfoDialog)!
    expect(renderToStaticMarkup(details.props.children as ReactElement)).toContain('HTTP 404')
    expect(html).toContain(props.t('runRecovery.abandon'))
  })

  it('connects the narrative retry button to explicit redelivery and disables it while disconnected', () => {
    const onRetryNarrativeInput = vi.fn()
    const props = {
      ...recoveryProps({ runRecovery: undefined }),
      canPreviewPrompt: false, canSendNarrative: false, narrativeInput: '',
      narrativeTextareaDisabled: false, onChangeNarrativeInput: vi.fn(),
      onPreviewPrompt: vi.fn(), onSubmitNarrative: vi.fn(),
      canRetryNarrativeInput: true, onRetryNarrativeInput,
    }
    const composer = elements(AgentComposer(props)).find(element => element.type === ChatComposer)!
    const controls = elements(ChatComposer(composer.props as Parameters<typeof ChatComposer>[0]))
    const retry = controls.find(element => element.type === 'button'
      && element.props['aria-label'] === props.t('swipe.reset'))!
    expect(retry.props.disabled).toBe(false)
    ;(retry.props.onClick as () => void)()
    expect(onRetryNarrativeInput).toHaveBeenCalledOnce()
    const disconnected = elements(AgentComposer({
      ...props, runRecovery: { target: 'narrative', status: 'disconnected' },
    })).find(element => element.type === ChatComposer)!
    expect(disconnected.props.canRetry).toBe(false)
  })

  it.each(['en-US', 'zh-CN'] as const)('labels disconnected recovery without resume or restore (%s)', locale => {
    const props = recoveryProps({ t: createTranslator(locale) })
    const html = renderToStaticMarkup(createElement(RunRecoveryControls, props))
    expect(html).toContain(props.t('runRecovery.disconnected'))
    expect(html).toContain(`aria-label="${props.t('runRecovery.reconnect')}"`)
    expect(html).not.toContain(props.t('agent.run.resume'))
    expect(html).not.toContain(props.t('runRecovery.restoreInput'))
  })

  it('catches an already reported reconnect failure at the event boundary', async () => {
    const props = recoveryProps({ reconnectAgentRun: vi.fn(async () => { throw new Error('reported') }) })
    const button = elements(RunRecoveryControls(props)).find(element => element.props['aria-label'] === 'Reconnect')!
    expect((button.props.onClick as () => void)()).toBeUndefined()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(props.reconnectAgentRun).toHaveBeenCalledOnce()
  })

  it.each(['failed', 'cancelled'] as const)('offers refresh and protects a new draft after %s', status => {
    const props = recoveryProps({ runRecovery: { target: 'agent', status, input: 'original', refreshFailed: true, error: 'reported failure' } })
    const controls = elements(RunRecoveryControls(props))
    const buttons = controls.filter(element => element.type !== InfoDialog && element.props['aria-label'])
    expect(buttons.map(button => button.props['aria-label'])).toEqual(['Refresh status', 'Restore original input'])
    expect(buttons[1].props.disabled).toBe(true)
    const html = renderToStaticMarkup(createElement(RunRecoveryControls, props))
    const details = controls.find(element => element.type === InfoDialog)!
    expect(renderToStaticMarkup(details.props.children as ReactElement)).toContain('reported failure')
    expect(html).toContain(props.t('runRecovery.refreshFailed'))
    const enabled = elements(RunRecoveryControls({ ...props, canRestoreRunInput: true }))
      .find(element => element.props['aria-label'] === 'Restore original input')!
    expect(enabled.props.disabled).toBe(false)
    ;(enabled.props.onClick as () => void)()
    expect(props.restoreRunInput).toHaveBeenCalledOnce()
    const busy = elements(RunRecoveryControls({ ...props, runRecoveryBusy: true, canRestoreRunInput: true }))
      .filter(element => element.type !== InfoDialog && element.props['aria-label'])
    expect(busy.every(button => button.props.disabled)).toBe(true)
  })

  it('does not offer refresh or input restoration without the corresponding terminal data', () => {
    const props = recoveryProps({ runRecovery: { target: 'narrative', status: 'failed' } })
    expect(elements(RunRecoveryControls(props)).some(element => element.props.onClick)).toBe(false)
    expect(RunRecoveryControls({ ...props, runRecovery: undefined })).toBeNull()
    expect(elements(RunRecoveryControls({ ...props, runRecovery: { target: 'agent', status: 'disconnected' }, runRecoveryBusy: true }))
      .find(element => element.props['aria-label'] === 'Reconnect')!.props.disabled).toBe(true)
  })

  it.each([
    { busy: true, activeRun: undefined },
    { busy: false, activeRun: { runId: 'run', status: 'running' as const } },
    { busy: false, activeRun: { runId: 'run', status: 'suspended' as const } },
  ])('keeps the Session draft editable and delegates busy submissions to its runtime handler: %j', state => {
    const onSubmit = vi.fn()
    const onChangeInput = vi.fn()
    const props = {
      ...recoveryProps({ runRecovery: undefined }), ...state, input: 'next message',
      messages: [], profiles: [], providerAccounts: [], selectedProfileId: 'profile',
      onChangeInput, onSelectProfile: vi.fn(), onSubmit,
    }
    const composer = elements(AgentChatPanel(props)).find(element => element.type === ChatComposer)!
    expect(composer.props.textareaDisabled).toBe(false)
    expect(composer.props.canSend).toBe(true)
    expect(composer.props.runStatus).toBe(state.activeRun?.status ?? 'running')
    ;(composer.props.onChangeInput as (value: string) => void)('draft while running')
    expect(onChangeInput).toHaveBeenCalledWith('draft while running')
    const preventDefault = vi.fn()
    ;(composer.props.onSubmit as (event: FormEvent) => void)({ preventDefault } as unknown as FormEvent)
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ preventDefault }))

    const idle = elements(AgentChatPanel({ ...props, busy: false, activeRun: undefined })).find(element => element.type === ChatComposer)!
    expect(idle.props.canSend).toBe(true)
    ;(idle.props.onSubmit as (event: FormEvent) => void)({ preventDefault } as unknown as FormEvent)
    expect(onSubmit).toHaveBeenCalledTimes(2)
  })

  it.each(['narrative', 'agent'] as const)('keeps drafts editable and blocks new turns in both composers when %s is disconnected', target => {
    const recovery = recoveryProps({ runRecovery: { target, status: 'disconnected' } })
    const onSubmit = vi.fn()
    const onChangeInput = vi.fn()
    const narrative = elements(AgentComposer({
      ...recovery, canPreviewPrompt: false, canSendNarrative: true, narrativeInput: 'new draft',
      narrativeTextareaDisabled: true, onChangeNarrativeInput: onChangeInput,
      onPreviewPrompt: vi.fn(), onSubmitNarrative: onSubmit,
    }))
    const agent = elements(AgentChatPanel({
      ...recovery, busy: true, input: 'new draft', messages: [], profiles: [], providerAccounts: [],
      selectedProfileId: 'profile', onChangeInput, onSelectProfile: vi.fn(), onSubmit,
    }))
    for (const tree of [narrative, agent]) {
      const composer = tree.find(element => element.type === ChatComposer)!
      expect(elements(composer.props.sheet).some(element => element.type === RunRecoveryControls)).toBe(false)
      expect(composer.props.canSend).toBe(false)
      expect(composer.props.textareaDisabled).toBe(false)
      expect(composer.props.input).toBe('new draft')
      const preventDefault = vi.fn()
      ;(composer.props.onSubmit as (event: FormEvent) => void)({ preventDefault } as unknown as FormEvent)
      expect(preventDefault).toHaveBeenCalledOnce()
      ;(composer.props.onChangeInput as (value: string) => void)('edited draft')
    }
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onChangeInput).toHaveBeenCalledTimes(2)
    expect(agent.find(element => element.type === ChatComposer)!.props.runStatus).toBe('idle')
    expect(narrative.some(element => element.type === RunRecoveryControls)).toBe(target === 'narrative')
    expect(agent.some(element => element.type === RunRecoveryControls)).toBe(target === 'agent')
    if (target === 'narrative') {
      expect(narrative.find(element => element.props['data-loom-object'] === 'agent-composer-layer')!.props['data-active']).toBe('true')
    }
  })
})

function panelProps(): AgentChatPanelProps {
  return {
    ...recoveryProps({ runRecovery: undefined }),
    busy: false, input: '', profiles: [], providerAccounts: [], messages: [],
    t: createTranslator('en-US'), onChangeInput: vi.fn(), onSelectProfile: vi.fn(), onSubmit: vi.fn(),
    session: { kind: 'agent' as const, id: 'session', agentPresetId: 'preset', title: 'Example', entryCount: 0, createdAt: '', updatedAt: '' },
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
