export function createHtmlHeightCache() {
  const heights = new Map<string, number>()
  let characters = 0
  // ponytail: Session-only layout hints, capped at 32 entries / 1M key characters.
  // Never persist source HTML or let long conversations retain unlimited text.
  return {
    read(key: string) {
      const height = heights.get(key)
      if (height !== undefined) { heights.delete(key); heights.set(key, height) }
      return height
    },
    write(key: string, height: number) {
      if (key.length > 1_000_000) return
      if (heights.delete(key)) characters -= key.length
      heights.set(key, height)
      characters += key.length
      while (heights.size > 32 || characters > 1_000_000) {
        const oldest = heights.keys().next().value!
        heights.delete(oldest)
        characters -= oldest.length
      }
    },
  }
}

export const htmlHeightCache = createHtmlHeightCache()
