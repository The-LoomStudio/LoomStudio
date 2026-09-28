import { createElement, isValidElement, type FormEvent, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { RunRecoveryControls, type RunRecoveryControlsProps } from '../../../apps/studio-client/src/features/narrative-runtime/ui/run-recovery-controls.js'
import { AgentComposer } from '../../../apps/studio-client/src/widgets/agent-composer/agent-composer.js'
import { AgentChatPanel } from '../../../apps/studio-client/src/widgets/agent-chat-panel/agent-chat-panel.js'
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
      && element.props['aria-label'] === props.t('composer.resendNarrativeInput'))!
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
    const buttons = controls.filter(element => element.props['aria-label'])
    expect(buttons.map(button => button.props['aria-label'])).toEqual(['Refresh status', 'Restore original input'])
    expect(buttons[1].props.disabled).toBe(true)
    const html = renderToStaticMarkup(createElement(RunRecoveryControls, props))
    expect(html).toContain('reported failure')
    expect(html).toContain(props.t('runRecovery.refreshFailed'))
    const enabled = elements(RunRecoveryControls({ ...props, canRestoreRunInput: true }))
      .find(element => element.props['aria-label'] === 'Restore original input')!
    expect(enabled.props.disabled).toBe(false)
    ;(enabled.props.onClick as () => void)()
    expect(props.restoreRunInput).toHaveBeenCalledOnce()
    const busy = elements(RunRecoveryControls({ ...props, runRecoveryBusy: true, canRestoreRunInput: true }))
      .filter(element => element.props['aria-label'])
    expect(busy.every(button => button.props.disabled)).toBe(true)
  })

  it('does not offer refresh or input restoration without the corresponding terminal data', () => {
    const props = recoveryProps({ runRecovery: { target: 'narrative', status: 'failed' } })
    expect(elements(RunRecoveryControls(props)).some(element => element.props.onClick)).toBe(false)
    expect(RunRecoveryControls({ ...props, runRecovery: undefined })).toBeNull()
    expect(elements(RunRecoveryControls({ ...props, runRecovery: { target: 'agent', status: 'disconnected' }, runRecoveryBusy: true }))
      .find(element => element.props['aria-label'] === 'Reconnect')!.props.disabled).toBe(true)
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
