import { useState } from 'react'

export function useBusyAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function runAction(action: () => Promise<void>) {
    setBusy(true)
    setError(undefined)

    try {
      await action()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  return { busy, error, runAction }
}
