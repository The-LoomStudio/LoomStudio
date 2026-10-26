// Independent native-scroll probe: real viewport, virtualizer and sandbox HTML.
// No business APIs, auth bootstrap, model calls or persistent preference stores.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { useConversationViewport } from '../../../apps/studio-client/src/shared/ui/conversation-viewport/use-conversation-viewport.js'
import { HtmlPreview } from '../../../apps/studio-client/src/features/message-content/ui/html-preview.js'

const items = [{ id: 'frame' }]
const html = '<html><body style="margin:0;height:1800px;background:linear-gradient(#e8eef8,#b8cee8);font:16px sans-serif"><p>在这个 iframe 内向上滚动：宿主必须让出滚动控制。</p><p style="margin-top:1300px">长文档底部</p></body></html>'
function Probe() {
  const view = useConversationViewport({ items, scopeId: 'scroll-probe', restoration: { view: 'timeline', scope: 'scroll-probe' } })
  return <main style={{ width: 720, margin: '30px auto', font: '16px sans-serif' }}>
    <h1>iframe 原生滚动诊断</h1>
    <p role="status">{view.smooth.following ? '正在跟随' : '已暂停跟随'}</p>
    <button onClick={view.smooth.resume}>回到最新</button>
    <div ref={view.scrollRef} onScroll={view.onScroll} tabIndex={0} aria-label="诊断阅读区"
      style={{ height: 400, overflowY: 'auto', overflowAnchor: 'none', border: '1px solid #888' }}>
      <div ref={view.contentRef}>
        <div ref={view.headerRef}>只检查实际输入和位置，不写业务数据。</div>
        <div ref={view.listRef} style={{ height: view.virtualizer.getTotalSize(), position: 'relative' }}>
          {view.virtualizer.getVirtualItems().map(row => <div key={items[row.index].id} data-index={row.index} ref={view.virtualizer.measureElement}
            style={{ position: 'absolute', top: row.start - view.scrollMargin, width: '100%' }}>
            <HtmlPreview value={html} />
          </div>)}
        </div>
      </div>
    </div>
  </main>
}
const root = createRoot(document.getElementById('root')!)
root.render(<Probe />)
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
