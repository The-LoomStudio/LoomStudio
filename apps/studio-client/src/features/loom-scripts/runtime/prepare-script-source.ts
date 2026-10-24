/** Download classic prerequisites without evaluating them in the host window. */
export async function prepareScriptSource(source: string, requires: readonly string[], signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  const prerequisites: string[] = []
  for (const url of requires) {
    const response = await fetch(url, { signal })
    if (!response.ok) throw new Error(`Loom Script dependency failed: ${url} (${response.status})`)
    prerequisites.push(await response.text())
    signal.throwIfAborted()
  }
  return [...prerequisites, source].join('\n;\n')
}
