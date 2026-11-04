// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import type { ManagedExtensionPackage } from '../../../apps/studio-client/src/entities/extension.js'
import type { Translator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import { ExtensionPackageResources } from '../../../apps/studio-client/src/features/extension-renderers/ui/extension-package-resources.js'

const boundary = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('../../../apps/studio-client/src/shared/api/session-fetch.js', () => ({ createSessionFetch: () => boundary.fetch }))

it('loads only card summaries until Info opens, then loads the selected files.v1 index and body with signals', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const pkg = { packageId: 'example.package', version: '1.0.0', fileRevision: 'revision-2',
    resources: { promptResources: [{ id: 'preset', resourceKind: 'preset', source: 'resources/index.json' }] },
  } as ManagedExtensionPackage
  boundary.fetch.mockImplementation(async (url: string) => {
    if (url.includes('?preview=summary&kind=preset')) return new Response(JSON.stringify({ title: 'Summary title', description: 'Summary description' }))
    if (url.endsWith('/index.json')) return new Response(JSON.stringify({ schema: 'loom.promptResource.files.v1', rootNode: {
      metadata: { label: 'Summary title', meta: 'Summary description' }, children: [{ metadata: { label: 'Body' }, body: 'body.md' }],
    } }))
    if (url.endsWith('/body.md')) return new Response('Full body only after Info')
    throw new Error(`Unexpected resource request: ${url}`)
  })
  async function settle() {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  }
  try {
    await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(ExtensionPackageResources, {
      extensionPackage: pkg, promptResources: [], onOpenResource: vi.fn(), t: ((key: string) => key) as Translator,
    }))))
    await settle()
    expect(boundary.fetch).toHaveBeenCalledTimes(1)
    expect(boundary.fetch.mock.calls[0]?.[0]).toBe('/extensions/example.package/revision-2/files/resources/index.json?preview=summary&kind=preset')
    expect(host.textContent).toContain('Summary title')
    expect(host.textContent).toContain('Summary description')
    expect(client.getQueryCache().getAll().map(query => query.state.data)).toEqual([{ title: 'Summary title', description: 'Summary description' }])
    await act(async () => (host.querySelector('[aria-label="renderer.resourceInfo"]') as HTMLButtonElement).click())
    for (let i = 0; i < 4; i++) await settle()
    expect(boundary.fetch.mock.calls.map(call => call[0])).toEqual([
      '/extensions/example.package/revision-2/files/resources/index.json?preview=summary&kind=preset',
      '/extensions/example.package/revision-2/files/resources/index.json',
      '/extensions/example.package/revision-2/files/resources/body.md',
    ])
    expect(document.body.textContent).toContain('Full body only after Info')
    for (const [, init] of boundary.fetch.mock.calls) expect(init.signal).toBeDefined()
  } finally {
    await act(async () => root.unmount())
    client.clear()
    host.remove()
    vi.unstubAllGlobals()
  }
})
