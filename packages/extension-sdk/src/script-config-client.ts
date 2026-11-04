import type { ClientExtensionActivationContext, ExtensionStorageScope, ScriptConfigEntry } from './index.js'

/** Shared by Script hosts. Config changes do not reload the running module. */
export function createScriptConfigClient(input: {
  signal: AbortSignal
  defaultScope(): ExtensionStorageScope
  assertScope(scope: ExtensionStorageScope, write: boolean): void
  list(scope: ExtensionStorageScope): Promise<ScriptConfigEntry[]>
  upsert(query: { scope: ExtensionStorageScope; key: string; value: import('@loom-studio/shared').JsonValue; expectedVersion?: number }): Promise<ScriptConfigEntry>
  onError(error: unknown): void
}): ClientExtensionActivationContext['configs'] {
  async function list(query?: { scope?: ExtensionStorageScope }) {
    input.signal.throwIfAborted()
    const scope = structuredClone(query?.scope ?? input.defaultScope())
    input.assertScope(scope, false)
    const entries = await input.list(scope)
    input.signal.throwIfAborted()
    input.assertScope(scope, false)
    return entries
  }
  return {
    list,
    get: async query => (await list(query)).find(entry => entry.key === query.key) ?? null,
    upsert: async query => {
      input.signal.throwIfAborted()
      const request = structuredClone(query)
      input.assertScope(request.scope, true)
      const entry = await input.upsert(request)
      input.signal.throwIfAborted()
      input.assertScope(request.scope, true)
      return entry
    },
    subscribe(query, handler) {
      input.signal.throwIfAborted()
      const scope = structuredClone(query.scope ?? input.defaultScope())
      input.assertScope(scope, false)
      let disposed = false
      let version: string | undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      const dispose = () => { disposed = true; clearTimeout(timer); input.signal.removeEventListener('abort', dispose) }
      input.signal.addEventListener('abort', dispose, { once: true })
      const refresh = async () => {
        try {
          const entries = await list({ scope })
          if (disposed) return
          const next = JSON.stringify(entries.map(entry => [entry.id, entry.version]).sort())
          if (next !== version) { await handler(entries); version = next }
          // ponytail: Script configs share storage but lack an owner-aware push channel.
          // Replace this bounded subscription poll when Config events expose Script ownership.
          if (!disposed) timer = setTimeout(() => { void refresh() }, 1000)
        } catch (error) { if (!disposed) { dispose(); input.onError(error) } }
      }
      void refresh()
      return { dispose }
    },
  }
}
