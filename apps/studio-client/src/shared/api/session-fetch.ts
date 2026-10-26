/** Retry only after authentication rejected a request before dispatch. */
export function createSessionFetch(fetchImpl: typeof fetch = globalThis.fetch, authEndpoint = '/auth/session'): typeof fetch {
  return async (input, init) => {
    const options = { ...init, credentials: 'same-origin' as const }
    let response = await fetchImpl(input, options)
    if (response.status === 401 && typeof globalThis.window !== 'undefined') {
      try {
        const auth = await fetchImpl(authEndpoint, { method: 'POST', credentials: 'same-origin', signal: init?.signal })
        if (auth.ok) response = await fetchImpl(input, options)
      } catch {
        init?.signal?.throwIfAborted()
      }
    }
    return response
  }
}
