import { useEffect, useState } from 'react'
import { countTexts } from './client.js'

export function useTokenCounts(texts: string[], scope: string) {
  const signature = JSON.stringify(texts)
  const [composing, setComposing] = useState(false)
  const [result, setResult] = useState<{ scope: string; signature: string; counts?: number[]; error?: string }>()
  useEffect(() => {
    const start = () => setComposing(true)
    const end = () => setComposing(false)
    document.addEventListener('compositionstart', start)
    document.addEventListener('compositionend', end)
    return () => {
      document.removeEventListener('compositionstart', start)
      document.removeEventListener('compositionend', end)
    }
  }, [])
  useEffect(() => {
    if (composing) return
    const abort = new AbortController()
    const timer = window.setTimeout(() => {
      void countTexts(JSON.parse(signature) as string[], abort.signal).then(
        counts => { if (!abort.signal.aborted) setResult({ scope, signature, counts }) },
        error => { if (!abort.signal.aborted) setResult({ scope, signature, error: String(error) }) },
      )
    }, 300)
    return () => { window.clearTimeout(timer); abort.abort() }
  }, [signature, scope, composing])
  const currentScope = result?.scope === scope ? result : undefined
  return {
    counts: currentScope?.counts,
    error: currentScope?.signature === signature ? currentScope.error : undefined,
    pending: composing || currentScope?.signature !== signature,
  }
}
