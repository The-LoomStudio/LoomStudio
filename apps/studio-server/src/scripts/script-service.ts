import type { ApplicationRuntime } from '@loom-studio/application-runtime'
import type { ExtensionHostOptions } from '@loom-studio/extension-host'
import { createServerScriptRuntime, type ServerScriptRun, type ServerScriptInstanceSummary } from './server-script-runtime.js'

export type ScriptContext = NonNullable<Parameters<ApplicationRuntime['resolveLoomScriptRendererMounts']>[0]>

/** Source and grants always come from the authoritative runtime, never the client request. */
export function createScriptService(options: { runtime: ApplicationRuntime; hostOptions: ExtensionHostOptions }) {
  const runtime = createServerScriptRuntime({ hostOptions: options.hostOptions, prepareSource })
  let context: ScriptContext = {}
  let sequence = 0
  let closed = false
  return {
    async resolve(input: ScriptContext = context) {
      const request = ++sequence
      context = structuredClone(input)
      const result = await options.runtime.resolveLoomScriptRendererMounts(input)
      if (closed || request !== sequence) return { ...result, serverInstances: runtime.list().map(instanceResponse) }
      const runs: ServerScriptRun[] = result.mounts.filter(mount => mount.enabled && mount.script.runtime === 'server').map(mount => ({
        ...mount,
        target: mount.target?.kind === 'card' ? { kind: 'card', cardId: mount.target.cardId } : { kind: 'global' },
      }))
      const serverInstances = await runtime.reconcile(runs)
      return { ...result, serverInstances: serverInstances.map(instanceResponse) }
    },
    async dispose() { closed = true; sequence++; await runtime.dispose() },
  }
}

function instanceResponse(instance: ServerScriptInstanceSummary) {
  return {
    mountId: instance.mountId,
    scriptDocumentId: instance.scriptDocumentId,
    runningDocumentVersion: instance.runningDocumentVersion,
    state: instance.state,
    diagnostics: instance.diagnostics.map(diagnostic => ({ code: diagnostic.code, message: diagnostic.message })),
  }
}

async function prepareSource(run: ServerScriptRun, lifecycleSignal: AbortSignal): Promise<string> {
  const dependencies: string[] = []
  const signal = AbortSignal.any([lifecycleSignal, AbortSignal.timeout(15_000)])
  for (const url of run.script.requires ?? []) {
    signal.throwIfAborted()
    const response = await fetch(url, { signal })
    if (!response.ok) throw new Error(`Script dependency failed (${response.status}): ${url}`)
    const reader = response.body?.getReader()
    if (!reader) throw new Error(`Script dependency has no body: ${url}`)
    let length = 0
    const chunks: Uint8Array[] = []
    try {
      while (true) {
        signal.throwIfAborted()
        const chunk = await reader.read()
        if (chunk.done) break
        length += chunk.value.byteLength
        if (length > 4 * 1024 * 1024) throw new Error(`Script dependency exceeds 4 MiB: ${url}`)
        chunks.push(chunk.value)
      }
    } finally { await reader.cancel(); reader.releaseLock() }
    dependencies.push(Buffer.concat(chunks).toString('utf8'))
  }
  signal.throwIfAborted()
  // @require is ordered classic code bundled into this invocation, not a remote ESM graph loader.
  return [...dependencies, run.source].join('\n;\n')
}
