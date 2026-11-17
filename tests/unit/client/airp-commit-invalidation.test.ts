// @vitest-environment happy-dom
import { defaultScheduler, notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCards } from '../../../apps/studio-client/src/features/cards/model/use-cards.js'
import { useProviderSettings } from '../../../apps/studio-client/src/features/provider-settings/model/use-provider-settings.js'
import { useTextTransformController } from '../../../apps/studio-client/src/features/text-transforms/model/use-text-transform-controller.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import { renderHook } from '../../support/client/render-hook.js'

class StubEventSource extends EventTarget {
  static OPEN = 1
  static CLOSED = 2
  static instances: StubEventSource[] = []
  readyState = 0
  closed = false
  constructor(readonly url: string) {
    super()
    StubEventSource.instances.push(this)
  }
  emit(name: string, data = '') {
    if (name === 'open') this.readyState = 1
    this.dispatchEvent(new MessageEvent(name, { data }))
  }
  close() {
    this.closed = true
    this.readyState = 2
  }
}

const cleanups: Array<() => void> = []

beforeEach(() => {
  notifyManager.setScheduler(queueMicrotask)
  StubEventSource.instances = []
  vi.stubGlobal('EventSource', StubEventSource)
})

afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup())
  notifyManager.setScheduler(defaultScheduler)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function flush() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
    })
  }
}

describe('airp.* and documents.* data commit invalidation', () => {
  it('actively refetches disabled useProviderSettings queries on airp.* commits, overflow, and reconnect', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const initialProvider = {
      id: 'prov-1', version: 1, providerExtensionId: 'official.openai-compatible',
      displayName: 'Initial', config: {}, enabledModelIds: [], credential: { configured: false },
      createdAt: '2026-11-17', updatedAt: '2026-11-17',
    }
    const updatedProvider = { ...initialProvider, version: 2, displayName: 'Updated via SSE' }
    const capability = {
      id: 'cap-1', version: 1, providerProfileId: 'prov-1', capabilityId: 'chat',
      displayName: 'Chat Cap', config: {}, available: true, createdAt: '2026-11-17', updatedAt: '2026-11-17',
    }

    const listAccounts = vi.fn()
      .mockResolvedValueOnce({ providerProfiles: [initialProvider] })
      .mockResolvedValue({ providerProfiles: [updatedProvider] })
    const listCapabilities = vi.fn().mockResolvedValue({ profiles: [capability] })
    const listProviders = vi.fn().mockResolvedValue([{ id: 'official.openai-compatible', displayName: 'OpenAI', capabilities: [], registeredBy: { kind: 'platform' } }])

    const api = {
      providerAccounts: { list: listAccounts },
      aiCapabilityProfiles: { list: listCapabilities },
      aiGateway: { listProviders },
    } as unknown as StudioApi

    const hook = renderHook(
      () => useProviderSettings({
        api,
        endpoint: '/test-sse',
        initialProviderAccountDraft: { displayName: '', baseUrl: '', apiKey: '' },
        runAction: action => action(),
      }),
      child => createElement(QueryClientProvider, { client }, child),
    )
    cleanups.push(() => { hook.unmount(); client.clear() })

    const stream = StubEventSource.instances[0]!
    expect(stream).toBeDefined()

    // 1. Initial SSE open triggers full refreshProviderSettings despite enabled: false
    await act(async () => { stream.emit('open') })
    await flush()
    expect(listAccounts).toHaveBeenCalledTimes(1)
    expect(listCapabilities).toHaveBeenCalledTimes(1)
    expect(listProviders).toHaveBeenCalledTimes(1)
    expect(hook.current.providerAccounts.map(item => item.displayName)).toEqual(['Initial'])

    // 2. airp.providerProfile data.changed actively refetches providerAccounts
    await act(async () => {
      stream.emit('data.changed', JSON.stringify({
        payload: { operations: [{ entityType: 'airp.providerProfile', entityId: 'prov-1', kind: 'update' }] },
      }))
    })
    await flush()
    expect(listAccounts).toHaveBeenCalledTimes(2)
    expect(listCapabilities).toHaveBeenCalledTimes(1)
    expect(hook.current.providerAccounts.map(item => item.displayName)).toEqual(['Updated via SSE'])

    // 3. airp.aiCapabilityProfile data.changed actively refetches aiCapabilityProfiles
    await act(async () => {
      stream.emit('data.changed', JSON.stringify({
        payload: { operations: [{ entityType: 'airp.aiCapabilityProfile', entityId: 'cap-1', kind: 'update' }] },
      }))
    })
    await flush()
    expect(listAccounts).toHaveBeenCalledTimes(2)
    expect(listCapabilities).toHaveBeenCalledTimes(2)

    // 4. overflow: true with collapsed documents.* triggers full reconnect refresh
    await act(async () => {
      stream.emit('data.changed', JSON.stringify({
        payload: {
          overflow: true,
          operations: [{ store: 'documents', entityType: 'documents.*', entityId: '*', count: 90 }],
        },
      }))
    })
    await flush()
    expect(listAccounts).toHaveBeenCalledTimes(3)
    expect(listCapabilities).toHaveBeenCalledTimes(3)
    expect(listProviders).toHaveBeenCalledTimes(2)
  })

  it('invalidates useCards on airp.cardSource and documents.* commits', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const listCards = vi.fn().mockResolvedValue({
      cards: [{
        id: 'card-1', name: 'Card One', version: 1, artifactId: 'art-1',
        userName: 'User', description: '', media: {}, createdAt: '2026-11-17', updatedAt: '2026-11-17',
      }],
    })
    const getCard = vi.fn().mockResolvedValue({
      card: {
        id: 'card-1', name: 'Card One', version: 1, artifactId: 'art-1', preset: {},
        opening: { id: 'open-1', content: '' }, lore: { entries: [] },
        createdAt: '2026-11-17', updatedAt: '2026-11-17',
      },
    })
    const api = {
      cards: { list: listCards, get: getCard },
      directories: {},
    } as unknown as StudioApi

    const hook = renderHook(
      () => useCards({
        api,
        initialCardName: '',
        recordEdit: vi.fn(),
        runAction: action => action(),
        t: createTranslator('zh-CN'),
      }),
      child => createElement(QueryClientProvider, { client }, child),
    )
    cleanups.push(() => { hook.unmount(); client.clear() })
    await flush()
    expect(listCards).toHaveBeenCalledTimes(1)

    const stream = StubEventSource.instances[0]!
    // Unrelated entityType should not invalidate cards
    await act(async () => {
      stream.emit('data.changed', JSON.stringify({
        payload: { operations: [{ entityType: 'airp.providerProfile', entityId: 'prov-1' }] },
      }))
    })
    await flush()
    expect(listCards).toHaveBeenCalledTimes(1)

    // airp.cardSource invalidates cards
    await act(async () => {
      stream.emit('data.changed', JSON.stringify({
        payload: { operations: [{ entityType: 'airp.cardSource', entityId: 'card-1' }] },
      }))
    })
    await flush()
    expect(listCards).toHaveBeenCalledTimes(2)

    // documents.* overflow marker (even without overflow flag) invalidates cards
    await act(async () => {
      stream.emit('data.changed', JSON.stringify({
        payload: { operations: [{ entityType: 'documents.*', entityId: '*' }] },
      }))
    })
    await flush()
    expect(listCards).toHaveBeenCalledTimes(3)
  })

  it('refreshes useTextTransformController on airp.textTransformRule, airp.textExtractor, and documents.* commits', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const listRules = vi.fn().mockResolvedValue({ rules: [] })
    const listExtractors = vi.fn().mockResolvedValue({ extractors: [] })
    const listRenderers = vi.fn().mockResolvedValue({ renderers: [] })
    const textApi = {
      listRules,
      listExtractors,
      listRenderers,
    } as unknown as StudioApi['textTransforms']

    const hook = renderHook(
      () => useTextTransformController({
        api: textApi,
        t: createTranslator('zh-CN'),
      }),
      child => createElement(QueryClientProvider, { client }, child),
    )
    cleanups.push(() => { hook.unmount(); client.clear() })
    await flush()
    expect(listRules).toHaveBeenCalledTimes(1)

    const stream = StubEventSource.instances[0]!
    await act(async () => {
      stream.emit('data.changed', JSON.stringify({
        payload: { operations: [{ entityType: 'airp.textTransformRule', entityId: 'rule-1' }] },
      }))
    })
    await flush()
    expect(listRules).toHaveBeenCalledTimes(2)

    await act(async () => {
      stream.emit('data.changed', JSON.stringify({
        payload: { operations: [{ entityType: 'airp.textExtractor', entityId: 'ext-1' }] },
      }))
    })
    await flush()
    expect(listRules).toHaveBeenCalledTimes(3)
    expect(listExtractors).toHaveBeenCalledTimes(3)

    await act(async () => {
      stream.emit('data.changed', JSON.stringify({
        payload: { operations: [{ entityType: 'documents.*', entityId: '*' }] },
      }))
    })
    await flush()
    expect(listRules).toHaveBeenCalledTimes(4)
  })
})
