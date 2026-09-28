// Local, disposable diagnostics. No backend, storage, real grants or business data.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createClientRendererHost } from '../../../apps/studio-client/src/shared/extension-renderer-runtime/client-renderer-host.js'
import { createLoomScriptRendererRuntime } from '../../../apps/studio-client/src/features/loom-scripts/runtime/loom-script-renderer-runtime.js'
import { RendererSurfaceHost } from '../../../apps/studio-client/src/features/extension-renderers/ui/renderer-surface-host.js'
import { RendererNodeMountHost } from '../../../apps/studio-client/src/features/extension-renderers/ui/renderer-node-mount-host.js'
import { HtmlPreview } from '../../../apps/studio-client/src/features/message-content/ui/html-preview.js'
import { MessageContent } from '../../../apps/studio-client/src/features/message-content/ui/message-content.js'
import { createRendererNotifications } from '../../../apps/studio-client/src/shared/extension-renderer-runtime/renderer-notifications.js'

const host = createClientRendererHost()
const log = document.createElement('pre')
log.id = 'results'
document.body.append(log)
const report = (text: string) => { log.textContent += `${text}\n` }
const notifications = createRendererNotifications((owner, input) => report(`${owner}: ${input.message}`))
const scope = { kind: 'timeline' as const, key: 'probe' }
let revision = 0
const source = `
let root, ctx, log=[], count=0;
export const renderers={status:{
  async mount(element, context) {
    root=element; ctx=context; log.push('mount-start');
    await ctx.capabilities.request({capability:'state.read',input:{target:{scope:'global'}}});
    await new Promise(resolve=>setTimeout(resolve,150));
    log.push('mount-end');
    root.innerHTML='<p id="order"></p><button id="notify">发送测试通知</button><button id="grow">展开内容</button><div id="extra"></div>';
    root.querySelector('#notify').onclick=async()=>{try{await ctx.notifications.show({message:'notice-'+(++count)});}catch(e){root.querySelector('#order').textContent=e.code+': '+e.message;}};
    root.querySelector('#grow').onclick=()=>{root.querySelector('#extra').style.height='360px';root.querySelector('#extra').textContent='expanded';};
    root.querySelector('#order').textContent=log.join(',');
  },
  async update(context){ctx=context;log.push('update-'+context.inputs[0]?.value?.value);root.querySelector('#order').textContent=log.join(',');},
  dispose(){log.push('dispose');}
}};`
const mounts = ['a', 'b'].map(id => ({
  mountId: id, enabled: true, orderIndex: 0, grantedCapabilities: ['state.read', 'ui.notify'], source,
  script: {
    id, version: 1, requestedCapabilities: ['state.read', 'ui.notify'],
    contributions: [{
      kind: 'renderer' as const,
      renderer: { id: 'status', name: `Script ${id}`, surface: 'narrative.timeline.tail' as const, instanceScope: 'timeline' as const },
      inputs: [{ kind: 'match' as const, ruleId: 'probe' }],
    }],
  },
}))
const runtime = createLoomScriptRendererRuntime({
  rendererHost: host,
  resolveInputs: () => ({ matches: [{ matchId: 'probe', ruleId: 'probe', value: revision, displayRange: { start: 0, end: 1 } }], artifacts: [] }),
  stateRead: async () => { revision++; host.invalidate(); return {} },
  notify: notifications.show,
})
runtime.reconcile(mounts)
const controller = new AbortController()
const extensionUrl = new URL('./iframe-sdk.html', import.meta.url).href
const extension = host.register({
  owner: { kind: 'extension', packageId: 'probe', moduleId: 'client' },
  definition: { id: 'extension', name: 'Extension SDK', adapter: 'sandbox-iframe', surface: 'narrative.timeline.tail', instanceScope: 'timeline' },
  mount() {},
  frame: { src: extensionUrl },
  frameNotifications: {
    signal: controller.signal,
    show: async input => { controller.signal.throwIfAborted(); notifications.show('extension:probe', input) },
  },
})
host.subscribe(() => {
  const diagnostics = host.diagnostics()
  const last = diagnostics.at(-1)
  if (last && !log.textContent?.includes(last.message)) report(`${last.code}: ${last.message}`)
})

function Probe() {
  const [visible, setVisible] = useState(true)
  const [showLayout, setShowLayout] = useState(true)
  const [narrow, setNarrow] = useState(false)
  return <>
    <h1>Iframe Runtime Probe</h1>
    <button onClick={() => { revision++; host.invalidate() }}>更新脚本输入</button>
    <button onClick={() => { runtime.reconcile(mounts.map(mount => ({ ...mount, grantedCapabilities: ['state.read'] }))); report('script grants revoked') }}>撤销脚本通知</button>
    <button onClick={() => { controller.abort(); report('extension grant revoked') }}>撤销扩展通知</button>
    <button onClick={() => { runtime.dispose(); extension.dispose(); setVisible(false); report('disposed') }}>卸载全部</button>
    {visible ? <RendererSurfaceHost host={host} surface="narrative.timeline.tail" scope={scope} /> : null}
    <h2>普通消息 HTML</h2>
    <HtmlPreview value={`<html><body><p>无业务 ctx</p><button onclick="document.body=document.createElement('body');document.body.innerHTML='<div style=&quot;height:420px&quot;>新 body</div>'">替换 body</button></body></html>`} />
    <h2>相邻消息界面</h2>
    <button onClick={() => setShowLayout(value => !value)}>挂载或卸载 HTML</button>
    <button onClick={() => setNarrow(value => !value)}>切换测试宽度</button>
    <div id="html-layout-probe" style={{ width: narrow ? 360 : 760, maxWidth: '100%' }}>
      {showLayout ? <MessageContent role="assistant" codeBlockLabels={{ copied: 'Copied', copy: 'Copy', copyFailed: 'Failed', disableWrap: 'No wrap', enableWrap: 'Wrap' }}
        value={'```html\n<html><body><p id="instance"></p><div style="height:1800px">Long interface</div><script>document.getElementById("instance").textContent=Math.random()</script></body></html>\n```\n\n```html\n<html><body><p>Second interface</p></body></html>\n```'} /> : null}
    </div>
    <h2>长代码宽度</h2>
    <article id="code-width-probe" style={{ width: narrow ? 360 : 760, maxWidth: '100%', padding: 20, boxSizing: 'border-box' }}>
      <RendererNodeMountHost host={host} surface="narrative" timelineId="probe" nodeId="code-probe"
        rawText={'```text\n' + 'long-token-'.repeat(500) + '\n```'} displayText={'```text\n' + 'long-token-'.repeat(500) + '\n```'}>
        <MessageContent role="assistant" codeBlockLabels={{ copied: 'Copied', copy: 'Copy', copyFailed: 'Failed', disableWrap: 'No wrap', enableWrap: 'Wrap' }}
          value={'```text\n' + 'long-token-'.repeat(500) + '\n```'} />
      </RendererNodeMountHost>
    </article>
  </>
}
const reactRoot = createRoot(document.getElementById('root')!)
reactRoot.render(<Probe />)
if (import.meta.hot) {
  import.meta.hot.accept(() => location.reload())
  import.meta.hot.dispose(() => {
    reactRoot.unmount()
    controller.abort()
    runtime.dispose()
    extension.dispose()
    log.remove()
  })
}
window.addEventListener('pagehide', () => { runtime.dispose(); extension.dispose() }, { once: true })
