// @vitest-environment happy-dom
import { createUnavailableClientExtensionDataApi } from '../../support/client/client-extension-data.js'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ClientExtensionActivationContext, ClientRendererContext, RegisteredClientBackground } from '@loom-studio/extension-sdk'
import { parseLoomScriptSource } from '../../../packages/application-runtime/src/scripts/loom-script-codec.js'
import { createClientScriptRuntime } from '../../../apps/studio-client/src/features/loom-scripts/model/client-script-runtime.js'
import { createClientExtensionHost, type ClientExtensionDataApi } from '../../../apps/studio-client/src/features/extension-renderers/model/client-extension-host.js'
import { createClientRendererHost } from '../../../apps/studio-client/src/shared/extension-renderer-runtime/client-renderer-host.js'
import type { ResolvedLoomScriptRendererMount } from '../../../apps/studio-client/src/entities/loom-script.js'
import * as sample from '../../../docs/architecture/extensions/examples/scene-background-card.loom.js'

const source = readFileSync('docs/architecture/extensions/examples/scene-background-card.loom.js', 'utf8')
const metadata = parseLoomScriptSource(source)
function mount(): ResolvedLoomScriptRendererMount {
  return {
    mountId: 'scene', mountVersion: 1, target: { kind: 'user' }, enabled: true, orderIndex: 0, source,
    grantedCapabilities: metadata.requestedCapabilities,
    script: { ...metadata, id: 'scene-script', version: 1 },
  }
}
const data = {} as ClientExtensionDataApi

describe('scene background script', () => {
  it('hot-replaces only an opted-in mount, restores the adopted source on exit and refuses metadata edits', async () => {
    const rendererHost = createClientRendererHost()
    rendererHost.setScopeSnapshot({ workspace: 'w', timelineId: 'story', branchId: 'main' })
    const events: string[] = []
    const runtime = createClientScriptRuntime({ rendererHost, data,
      loadSource: async code => ({ activate(ctx) {
        const label = `${ctx.extension.moduleId}:${code.includes('HMR_UPDATED') ? 'hot' : 'saved'}`
        events.push(`start:${label}`)
        return { dispose() { events.push(`stop:${label}`) } }
      } }),
    })
    const first = mount(), other = { ...mount(), mountId: 'other' }
    first.script = { ...first.script, contributions: [] }
    other.script = { ...other.script, contributions: [] }
    const updated = source.replace('下一幕，去哪里？', 'HMR_UPDATED')
    try {
      await runtime.reconcile([first, other])
      const hot = new Map([[first.mountId, updated]])
      await runtime.reconcile([first, other], hot)
      await runtime.reconcile([first, other], hot)
      expect(events).toEqual(['start:scene:saved', 'start:other:saved', 'stop:scene:saved', 'start:scene:hot'])
      expect(() => runtime.reconcile([first, other], new Map([[first.mountId, updated.replace('@runtime client', '@runtime server')]]))).toThrow('Metadata')
      expect(events).toHaveLength(4)
      await runtime.reconcile([first, other])
      expect(events.slice(-2)).toEqual(['stop:scene:hot', 'start:scene:saved'])
      expect(first.source).toBe(source)
      expect(first.mountVersion).toBe(1)
    } finally { await runtime.dispose() }
  })
  it('allows a self-contained Client UI while retaining required sandbox inputs', () => {
    expect(metadata.contributions[0]).toMatchObject({ kind: 'renderer', inputs: [] })
    const sandbox = source.replace('// @runtime client', '// @runtime client-sandbox').replace('// @capability assets.read\n', '')
    expect(() => parseLoomScriptSource(sandbox)).toThrow('Sandbox Renderer requires inputs')
  })
  it('requires assets.read, limits Card resources to the current Card, clones results and revokes stopped contexts', async () => {
    const rendererHost = createClientRendererHost()
    rendererHost.setScopeSnapshot({ workspace: 'w', cardId: 'a' })
    const resource = (key: string, cardId?: string): RegisteredClientBackground => ({
      id: key, key, name: key, packageId: 'test', image: '/image.png', description: '',
      ...(cardId ? { target: { kind: 'card', cardId } as const } : {}),
    })
    const resources = [resource('global'), resource('a', 'a'), resource('b', 'b')]
    let context!: ClientExtensionActivationContext
    const runtime = createClientScriptRuntime({ rendererHost, data, listBackgrounds: () => resources,
      loadSource: async () => ({ activate: ctx => { context = ctx } }),
    })
    const first = mount()
    try {
      await runtime.reconcile([{ ...first, grantedCapabilities: ['runtime.client'], script: { ...first.script, requestedCapabilities: ['runtime.client'], contributions: [] } }])
      expect(() => context.backgrounds.list()).toThrow('assets.read')
      await runtime.reconcile([{ ...first, mountVersion: 2, script: { ...first.script, contributions: [] } }])
      const result = context.backgrounds.list()
      expect(result.map(item => item.key)).toEqual(['global', 'a'])
      result[0].image = '/changed'
      expect(resources[0].image).toBe('/image.png')
      rendererHost.setScopeSnapshot({ workspace: 'w', cardId: 'b' })
      expect(context.backgrounds.list().map(item => item.key)).toEqual(['global', 'b'])
      await runtime.reconcile([])
      expect(() => context.backgrounds.list()).toThrow()
    } finally { await runtime.dispose() }
  })

  it('uses the extension background catalog, switches images, handles missing assets and removes UI on stop', async () => {
    const rendererHost = createClientRendererHost()
    rendererHost.setScopeSnapshot({ workspace: 'w', timelineId: 'story', branchId: 'main' })
    const extensionHost = createClientExtensionHost({ data: createUnavailableClientExtensionDataApi(), rendererHost })
    await extensionHost.reconcile([{
      packageId: 'official.backgrounds', version: '1.0.0', fileRevision: 'revision-2', displayName: '官方背景', available: true,
      tags: [], sourceKinds: ['repository'], modules: [], resources: { backgrounds: [
        { id: 'one', name: '第一幕', description: '院落', image: 'Assets/one.png' },
        { id: 'two', name: '第二幕', description: '长街', image: 'Assets/two.png' },
      ] },
    }])
    const runtime = createClientScriptRuntime({ rendererHost, data, listBackgrounds: extensionHost.backgrounds, loadSource: async () => sample })
    const root = document.createElement('div')
    document.body.append(root)
    try {
      await runtime.reconcile([mount()])
      expect(runtime.host.diagnostics()).toEqual([])
      const registration = rendererHost.list('narrative.timeline.tail')[0]
      const renderContext = { signal: new AbortController().signal } as ClientRendererContext
      await registration.mount(root, renderContext)
      const shadow = root.querySelector('[data-scene-background-card]')!.shadowRoot!
      const currentImage = () => shadow.querySelector<HTMLImageElement>('.picture img')!
      expect(currentImage().getAttribute('src')).toBe(extensionHost.backgrounds()[0].image)
      expect(currentImage().src).toContain('/revision-2/')
      const previous = currentImage()
      shadow.querySelector<HTMLButtonElement>('[data-action="next"]')!.click()
      expect(currentImage().alt).toBe('长街')
      previous.dispatchEvent(new Event('error'))
      expect(shadow.querySelector('.status')!.textContent).toBe('图片加载中…')
      currentImage().dispatchEvent(new Event('load'))
      expect(shadow.querySelector('.status')!.textContent).toBe('图片已加载')
      currentImage().dispatchEvent(new Event('error'))
      expect(shadow.querySelector('.status')!.textContent).toContain('图片加载失败')
      await extensionHost.reconcile([])
      shadow.querySelector<HTMLButtonElement>('[data-action="reload"]')!.click()
      expect(shadow.querySelector('.status')!.textContent).toContain('请安装或启用官方背景包')
      expect(shadow.querySelector<HTMLButtonElement>('[data-action="next"]')!.disabled).toBe(true)
      await runtime.reconcile([])
      expect(root.childElementCount).toBe(0)
      expect(rendererHost.list('narrative.timeline.tail')).toEqual([])
    } finally { await runtime.dispose(); await extensionHost.dispose(); root.remove() }
  })
})
