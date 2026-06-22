import { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { RendererPocEvent, RendererPocState } from './entities/index.js'
import { createRendererSdk } from './renderer-sdk.js'
import './renderer.css'

const zhCN = {
  'renderer.title': 'Custom Renderer PoC',
  'renderer.status.connected': '已连接',
  'renderer.status.missing': '缺少 renderer session。',
  'renderer.action.increment': '增加好感度',
  'renderer.action.append': '追加 Renderer 消息',
  'renderer.action.breakCss': '破坏 Renderer CSS',
  'renderer.action.throw': '抛出 Renderer 错误',
}

function RendererApp() {
  const sessionId = readSessionId()
  const sdk = useMemo(() => sessionId ? createRendererSdk({ sessionId }) : undefined, [sessionId])
  const [state, setState] = useState<RendererPocState>()
  const [events, setEvents] = useState<string[]>([])
  const [brokenCss, setBrokenCss] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!sdk) return
    let disposed = false
    const unsubscribe = sdk.events.subscribe((event: RendererPocEvent) => {
      if (disposed) return
      setEvents(current => [`${new Date().toLocaleTimeString()} ${event.type}`, ...current].slice(0, 8))
      if ('state' in event) setState(event.state)
      if (event.type === 'session.revoked') setError('Renderer session revoked.')
    })

    void sdk.state.get()
      .then(nextState => {
        if (!disposed) setState(nextState)
      })
      .catch(caught => setError(caught instanceof Error ? caught.message : String(caught)))

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [sdk])

  if (!sessionId || !sdk) {
    return <main className="renderer-page"><p role="alert">{t('renderer.status.missing')}</p></main>
  }

  async function incrementLove() {
    if (!sdk || !state) return
    setState(await sdk.state.set('loveLevel', state.loveLevel + 1))
  }

  async function appendMessage() {
    if (!sdk) return
    await sdk.messages.append({
      role: 'assistant',
      content: `Renderer wrote this at ${new Date().toLocaleTimeString()}.`,
    })
  }

  function throwRendererError() {
    throw new Error('Renderer PoC deliberate runtime error')
  }

  return (
    <main className={brokenCss ? 'renderer-page broken' : 'renderer-page'}>
      <header className="renderer-hero">
        <div>
          <p>{t('renderer.status.connected')}</p>
          <h1>{t('renderer.title')}</h1>
        </div>
        <code>{sessionId}</code>
      </header>

      {error ? <p className="renderer-error" role="alert">{error}</p> : null}
      <p className="renderer-live" aria-live="polite">
        loveLevel {state?.loveLevel ?? '-'} / messages {state?.messages.length ?? 0}
      </p>

      <section className="renderer-actions" aria-label="Renderer controls">
        <button type="button" onClick={() => { void incrementLove() }}>{t('renderer.action.increment')}</button>
        <button type="button" onClick={() => { void appendMessage() }}>{t('renderer.action.append')}</button>
        <button type="button" onClick={() => setBrokenCss(true)}>{t('renderer.action.breakCss')}</button>
        <button type="button" onClick={throwRendererError}>{t('renderer.action.throw')}</button>
      </section>

      <section className="renderer-messages" aria-label="Renderer messages">
        {state?.messages.map(message => (
          <article className={`renderer-message ${message.role}`} key={message.id}>
            <strong>{message.role}</strong>
            <p>{message.content}</p>
          </article>
        ))}
      </section>

      <aside className="renderer-events" aria-label="Renderer event log">
        {events.map(item => <div key={item}>{item}</div>)}
      </aside>
    </main>
  )
}

function readSessionId(): string | undefined {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  return hash.get('session') ?? undefined
}

function t(key: keyof typeof zhCN): string {
  return zhCN[key]
}

const root = document.getElementById('renderer-root')

if (root) {
  createRoot(root).render(<RendererApp />)
}
