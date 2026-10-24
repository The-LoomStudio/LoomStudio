import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@loom-studio/ui'
import type { RegisteredClientBackground } from '@loom-studio/extension-sdk'
import source from '../../../../docs/architecture/extensions/examples/scene-background-card.loom.js?raw'
import manifestText from '../../../../official/extensions/backgrounds/manifest.json?raw'
import { StartupReady } from '../app/startup-curtain.js'
import { createClientRendererHost } from '../shared/extension-renderer-runtime/client-renderer-host.js'
import { createClientScriptRuntime } from '../features/loom-scripts/model/client-script-runtime.js'
import type { ClientExtensionDataApi } from '../features/extension-renderers/model/client-extension-host.js'
import { RendererSurfaceHost } from '../features/extension-renderers/ui/renderer-surface-host.js'
import { downloadBlob } from '../shared/browser/download.js'
import '../styles/global.css'
import styles from './scene-card-preview.module.scss'

// Only the development preview loads repository fixtures. The installed script uses the live Host catalog.
const assets = import.meta.glob<string>('../../../../official/extensions/backgrounds/Assets/*.png', { eager: true, query: '?url', import: 'default' })
const manifest = JSON.parse(manifestText) as { id: string; contributes: { backgrounds: Array<{ id: string; name: string; description: string; image: string }> } }
const backgrounds: RegisteredClientBackground[] = manifest.contributes.backgrounds.map(item => ({
  ...item, key: `${manifest.id}/${item.id}`, packageId: manifest.id,
  image: assets[`../../../../official/extensions/backgrounds/${item.image}`],
}))
const contribution = JSON.parse(source.split('\n').find(line => line.startsWith('// @contribution '))!.slice('// @contribution '.length)) as { id: string; name: string }

export function SceneCardPreview() {
  const [enabled, setEnabled] = useState(true)
  const [empty, setEmpty] = useState(false)
  const [version, setVersion] = useState(1)
  const [error, setError] = useState('')
  const emptyRef = useRef(empty)
  emptyRef.current = empty
  const rendererHost = useMemo(() => {
    const host = createClientRendererHost()
    host.setScopeSnapshot({ workspace: 'scene-preview', timelineId: 'scene-preview', branchId: 'main' })
    return host
  }, [])
  const runtime = useMemo(() => createClientScriptRuntime({
    rendererHost,
    // No business API is used by this read-only UI script.
    data: {} as ClientExtensionDataApi,
    listBackgrounds: () => emptyRef.current ? [] : backgrounds,
  }), [rendererHost])
  useEffect(() => () => { void runtime.dispose() }, [runtime])
  useEffect(() => {
    let current = true
    void runtime.reconcile(enabled ? [{
      mountId: 'scene-preview', mountVersion: version, target: { kind: 'user' }, enabled: true, orderIndex: 0,
      source, grantedCapabilities: ['runtime.client', 'assets.read'],
      script: {
        id: 'scene-preview', version: 1, metadataId: 'example.scene-background-card', name: '场景背景卡', scriptVersion: '1.0.0', runtime: 'client',
        requestedCapabilities: ['runtime.client', 'assets.read'], contributions: [{ kind: 'renderer',
          renderer: { id: contribution.id, name: contribution.name, surface: 'narrative.timeline.tail', instanceScope: 'timeline' },
          inputs: [],
        }],
      },
    }] : []).then(() => { if (current) setError(runtime.host.diagnostics().map(item => item.message).join('\n')) }).catch(cause => { if (current) setError(String(cause)) })
    return () => { current = false }
  }, [runtime, enabled, version])
  return <main className={styles.page}>
    <StartupReady />
    <header><h1>场景背景卡 · 脚本示例</h1><p>同一份单文件脚本，通过真实 Script Runtime 和 Renderer 宿主运行。此页只用仓库官方背景图片，不读取或修改工作台数据。</p></header>
    <div className={styles.controls}>
      <Button size="small" onClick={() => setEnabled(value => !value)}>{enabled ? '停用示例' : '启用示例'}</Button>
      <Button size="small" disabled={!enabled} onClick={() => setVersion(value => value + 1)}>刷新脚本实例</Button>
      <Button size="small" onClick={() => downloadBlob(new Blob([source], { type: 'text/javascript' }), 'scene-background-card.loom.js')}>下载示例脚本</Button>
      <label><input type="checkbox" checked={empty} onChange={event => setEmpty(event.target.checked)} />模拟缺少背景包（勾选后点击卡片内“刷新资源”）</label>
    </div>
    {error && <p role="alert">{error}</p>}
    <section className={styles.story} aria-label="故事场景预览"><p>你停下脚步，展开手中的地图。下一段旅程，会从哪里开始？</p></section>
    <RendererSurfaceHost host={rendererHost} surface="narrative.timeline.tail" scope={{ kind: 'timeline', key: 'scene-preview' }} />
    {!enabled && <p role="status">示例已停用，卡片与事件监听已卸载。</p>}
  </main>
}
