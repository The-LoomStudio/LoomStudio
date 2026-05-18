import { createClientBridge, type ClientJsonValue } from '@loom-studio/client-bridge'
import { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

type PanelState = {
  ping?: ClientJsonValue
  info?: ClientJsonValue
  introspect?: ClientJsonValue
  documents?: ClientJsonValue
  writeResult?: ClientJsonValue
  loomResult?: ClientJsonValue
  echoResult?: ClientJsonValue
  diagnostics?: ClientJsonValue
  traces?: ClientJsonValue
  error?: string
}

const defaultEndpoint = '/rpc'

function App() {
  const [endpoint, setEndpoint] = useState(defaultEndpoint)
  const [state, setState] = useState<PanelState>({})
  const [busy, setBusy] = useState(false)
  const bridge = useMemo(() => createClientBridge({ endpoint, source: 'studio-client' }), [endpoint])

  async function runAction(action: () => Promise<Partial<PanelState>>) {
    setBusy(true)
    setState(current => ({ ...current, error: undefined }))
    try {
      const result = await action()
      setState(current => ({ ...current, ...result }))
    } catch (error) {
      setState(current => ({ ...current, error: error instanceof Error ? error.message : String(error) }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Loom Studio MVP Stage 4</p>
          <h1>Studio Client 操作台</h1>
          <p className="summary">通过 Client Bridge 调用 Kernel RPC，验证 ping、introspection、documents、loom.run、extension RPC 与 diagnostics。</p>
        </div>
        <label className="endpoint">
          RPC Endpoint
          <input value={endpoint} onChange={event => setEndpoint(event.target.value)} />
        </label>
      </section>

      <section className="actions" aria-label="操作">
        <button disabled={busy} onClick={() => runAction(async () => ({ ping: await bridge.call('system.ping', { echo: 'stage-4' }) }))}>system.ping</button>
        <button disabled={busy} onClick={() => runAction(async () => ({ info: await bridge.call('system.getInfo') }))}>system.getInfo</button>
        <button disabled={busy} onClick={() => runAction(async () => ({ introspect: await bridge.call('system.introspect', { includeDiagnostics: true }) }))}>system.introspect</button>
        <button disabled={busy} onClick={() => runAction(async () => ({ documents: await bridge.call('docs.list') }))}>docs.list</button>
        <button disabled={busy} onClick={() => runAction(async () => ({ writeResult: await bridge.call('docs.write', sampleDocument()) }))}>docs.write</button>
        <button disabled={busy} onClick={() => runAction(async () => ({ loomResult: await bridge.call('loom.run', sampleLoomRun()) }))}>loom.run</button>
        <button disabled={busy} onClick={() => runAction(async () => ({ echoResult: await bridge.call('example.echo.echo', { message: 'hello from client' }) }))}>example.echo.echo</button>
        <button disabled={busy} onClick={() => runAction(async () => ({ diagnostics: await bridge.call('diagnostics.list') }))}>diagnostics.list</button>
        <button disabled={busy} onClick={() => runAction(async () => ({ traces: await bridge.call('trace.list') }))}>trace.list</button>
      </section>

      {state.error ? <section className="error">{state.error}</section> : null}

      <section className="grid">
        <ResultPanel title="Ping" value={state.ping} />
        <ResultPanel title="System Info" value={state.info} />
        <ResultPanel title="Introspection" value={state.introspect} />
        <ResultPanel title="Documents" value={state.documents} />
        <ResultPanel title="Document Write" value={state.writeResult} />
        <ResultPanel title="Loom Run" value={state.loomResult} />
        <ResultPanel title="Example Echo" value={state.echoResult} />
        <ResultPanel title="Diagnostics" value={state.diagnostics} />
        <ResultPanel title="Traces" value={state.traces} />
      </section>
    </main>
  )
}

function ResultPanel(props: { title: string; value?: ClientJsonValue }) {
  return (
    <article className="panel">
      <h2>{props.title}</h2>
      <pre>{props.value === undefined ? '等待调用' : JSON.stringify(props.value, null, 2)}</pre>
    </article>
  )
}

function sampleDocument(): ClientJsonValue {
  return {
    type: 'example.stage4.note',
    content: {
      title: 'Stage 4 client document',
      createdFrom: 'apps/studio-client',
    },
    reason: 'Stage 4 manual client write',
  }
}

function sampleLoomRun(): ClientJsonValue {
  return {
    fragments: [
      {
        id: 'stage-4-fragment',
        content: 'hello loom stage 4',
        meta: { __owner: 'stage-4-client' },
      },
    ],
    passes: [{ name: 'uppercase' }],
    trace: { enabled: true },
  }
}

const root = document.getElementById('root')

if (root) {
  createRoot(root).render(<App />)
}
