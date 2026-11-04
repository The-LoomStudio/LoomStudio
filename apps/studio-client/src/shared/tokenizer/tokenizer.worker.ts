import { countText } from '@loom-studio/tokenizer'

const cache = new Map<string, number>()
const CACHE_LIMIT = 2048
self.onmessage = async (event: MessageEvent<{ id: number; texts: string[] }>) => {
  const { id, texts } = event.data
  try {
    const counts: number[] = []
    for (const text of texts) {
      // LAN HTTP lacks SubtleCrypto; hashing is only a cache optimization.
      if (!crypto.subtle) {
        counts.push(countText(text).baseTokens)
        continue
      }
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
      const key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
      let count = cache.get(key)
      if (count === undefined) {
        count = countText(text).baseTokens
        cache.set(key, count)
        if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!)
      }
      counts.push(count)
    }
    self.postMessage({ id, counts })
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
}
