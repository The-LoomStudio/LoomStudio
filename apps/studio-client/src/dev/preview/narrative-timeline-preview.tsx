import { useRef, useState } from 'react'
import type { NarrativeNode } from '../../entities/index.js'
import { createTranslator } from '../../shared/i18n/index.js'
import { NarrativeTimeline } from '../../widgets/narrative-timeline/narrative-timeline.js'
import { createClientRendererHost } from '../../shared/extension-renderer-runtime/client-renderer-host.js'

const nodes: NarrativeNode[] = Array.from({ length: 1000 }, (_, index) => ({
  id: `preview-${index}`,
  timelineId: 'preview',
  stateRevisionId: 'preview',
  createdAt: '2026-09-23T00:00:00Z',
  body: {
    format: 'loom-markdown.v1',
    raw: `## Message ${index}\n\n${'Variable height narrative paragraph with **Markdown**.\n\n'.repeat(index % 9 + 1)}`,
  },
}))

export function NarrativeTimelinePreview() {
  const counters = useRef({ mounted: 0, disposed: 0 })
  const [rendererHost] = useState(() => {
    const host = createClientRendererHost()
    host.register({
      owner: { kind: 'extension', packageId: 'preview', moduleId: 'client' },
      definition: { id: 'inline', name: 'Preview', surface: 'narrative.entry.inline', instanceScope: 'node' },
      projectNode: () => [{ key: 'input', target: { slot: 'node.after' }, part: { type: 'text', content: '' } }],
      mount: (root, context) => {
        counters.current.mounted++
        const input = document.createElement('input')
        input.setAttribute('aria-label', `Renderer ${context.scope.key}`)
        input.defaultValue = 'temporary renderer state'
        root.append(input)
        return { dispose: () => { counters.current.disposed++ } }
      },
    })
    return host
  })
  const [metrics, setMetrics] = useState('')
  const [start, setStart] = useState(800)
  const [timeline, setTimeline] = useState(nodes)
  const [anchor, setAnchor] = useState<string>()
  const [overscan, setOverscan] = useState(5)
  return (
    <main style={{ height: '100dvh', display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)' }}>
      <header>
        <button onClick={() => setAnchor('preview-0')}>First message</button>
        <button onClick={() => setAnchor('preview-999')}>Last message</button>
        <button disabled={start === 0} onClick={() => setStart(value => Math.max(0, value - 100))}>Prepend page</button>
        <button onClick={() => setMetrics(JSON.stringify({ ...counters.current, live: rendererHost.instances().length }))}>Inspect renderer</button>
        <output aria-label="Renderer counts">{metrics}</output>
        <label>Overscan <input type="number" min={0} max={50} value={overscan} onChange={event => setOverscan(Number(event.target.value))} /></label>
      </header>
      <NarrativeTimeline
        anchorNodeId={anchor}
        busy={false}
        composerHeight={0}
        emptyTimelineText=""
        getNodeLink={id => id}
        hasOlder={start > 0}
        onEditNode={async (id, raw) => setTimeline(previous => previous.map(node => node.id === id ? { ...node, body: { ...node.body, raw } } : node))}
        onForkNode={() => undefined}
        onLoadOlder={async () => setStart(value => Math.max(0, value - 100))}
        onNodeAnchorChange={setAnchor}
        overscan={overscan}
        rendererHost={rendererHost}
        t={createTranslator('en-US')}
        timeline={timeline.slice(start)}
        timelineId="preview"
        tail={<input aria-label="Tail state" defaultValue="persistent tail" />}
      />
    </main>
  )
}
